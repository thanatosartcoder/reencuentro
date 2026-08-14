import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MissingPersonReport } from 'src/modules/persons/entities/missing-person-report.entity';
import { SightingReport } from 'src/modules/persons/entities/sighting-report.entity';
import { MissingStatus } from 'src/modules/persons/persons.enums';
import { buildPfifDocument, type PfifScope } from './pfif.builder';

const DEFAULT_DOMAIN = process.env.PFIF_DOMAIN ?? 'reencuentro.co';
const DEFAULT_EXPIRY_DAYS = Number(process.env.PFIF_EXPIRY_DAYS ?? 180);

@Injectable()
export class ExportService {
  constructor(
    @InjectRepository(MissingPersonReport)
    private readonly missingRepo: Repository<MissingPersonReport>,
    @InjectRepository(SightingReport)
    private readonly sightingRepo: Repository<SightingReport>,
  ) {}

  /**
   * Genera el documento PFIF.
   *
   * En alcance `public` solo salen los reportes cuyo autor autorizó la
   * publicación. La exportación no puede convertirse en la puerta trasera por
   * la que se difunde lo que la persona pidió mantener fuera del listado
   * abierto: quien negó el consentimiento espera que valga en todos los
   * canales, no solo en la pantalla.
   */
  async buildPfif(options: {
    scope: PfifScope;
    since?: Date;
    status?: MissingStatus;
    department?: string;
    limit: number;
    baseUrl: string;
  }): Promise<{ xml: string; counts: { missing: number; sightings: number } }> {
    const missingQb = this.missingRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.photos', 'photo')
      .where('m."deletedAt" IS NULL');

    if (options.scope === 'public') {
      missingQb.andWhere('m."consentPublicListing" = true');
    }
    if (options.since) {
      missingQb.andWhere('m."updatedAt" >= :since', { since: options.since });
    }
    if (options.status) {
      missingQb.andWhere('m.status = :status', { status: options.status });
    }
    if (options.department) {
      missingQb.andWhere('m.department = :department', { department: options.department });
    }

    // Ruta de propiedad y no SQL entre comillas: al paginar con `take` sobre
    // una consulta con joins, TypeORM tiene que resolver las columnas del
    // ORDER BY para armar la subconsulta de ids, y no puede mapear una
    // expresión cruda.
    const missing = await missingQb.orderBy('m.createdAt', 'DESC').take(options.limit).getMany();

    const sightingQb = this.sightingRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.photos', 'photo')
      .where('s."deletedAt" IS NULL')
      .andWhere("s.status <> 'DISCARDED'");

    if (options.since) {
      sightingQb.andWhere('s."updatedAt" >= :since', { since: options.since });
    }
    if (options.department) {
      sightingQb.andWhere('s.department = :department', { department: options.department });
    }

    const sightings = await sightingQb.orderBy('s.seenAt', 'DESC').take(options.limit).getMany();

    const xml = buildPfifDocument({
      missing,
      sightings,
      baseUrl: options.baseUrl,
      options: {
        domain: DEFAULT_DOMAIN,
        scope: options.scope,
        expiryDays: DEFAULT_EXPIRY_DAYS,
      },
    });

    return { xml, counts: { missing: missing.length, sightings: sightings.length } };
  }
}
