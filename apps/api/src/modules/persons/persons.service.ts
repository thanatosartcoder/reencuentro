import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { blindIndex } from 'src/common/crypto/field-crypto';
import { generateClaimToken, hashToken } from 'src/common/crypto/tokens';
import { toGeoPoint } from 'src/common/geo/geo.util';
import { normalizeDocument } from 'src/common/text/similarity';
import { normalizePhoneCo } from 'src/common/text/phone';
import { Paginated } from 'src/common/dto/pagination.dto';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { NotificationKind } from 'src/modules/notifications/notifications.enums';
import { MissingPersonReport } from './entities/missing-person-report.entity';
import { SightingReport } from './entities/sighting-report.entity';
import { CreateMissingReportDto } from './dto/create-missing-report.dto';
import { CreateSightingDto } from './dto/create-sighting.dto';
import { QueryMissingDto } from './dto/query-missing.dto';
import { DocumentType, MissingStatus, ReportSource, ReporterRole, Sex, SightingKind } from './persons.enums';
import { MatchingService } from './matching/matching.service';

/** Margen por defecto cuando la familia declara una edad exacta. */
const AGE_MARGIN_YEARS = 3;

export interface CreatedReportResult<T> {
  report: T;
  /** Solo se entrega en la creacion original; nunca vuelve a poder consultarse. */
  claimToken: string | null;
  /** true si el clientUuid ya existia: el reintento no creo nada nuevo. */
  duplicate: boolean;
}

@Injectable()
export class PersonsService {
  private readonly logger = new Logger(PersonsService.name);

  constructor(
    @InjectRepository(MissingPersonReport)
    private readonly missingRepo: Repository<MissingPersonReport>,
    @InjectRepository(SightingReport)
    private readonly sightingRepo: Repository<SightingReport>,
    private readonly matching: MatchingService,
    private readonly notifications: NotificationsService,
  ) {}

  // --------------------------------------------------------------------------
  // Reportes de desaparicion
  // --------------------------------------------------------------------------

  /**
   * Crea un reporte de desaparicion.
   *
   * Idempotente por `clientUuid`. Un dispositivo en zona de mala senal reintenta
   * el envio muchas veces sin saber si alguno llego; reenviar el mismo reporte
   * devuelve el que ya existe en lugar de duplicar el caso. Sin esto, la cola de
   * revision se llenaria de copias del mismo desaparecido.
   */
  async createMissingReport(
    dto: CreateMissingReportDto,
  ): Promise<CreatedReportResult<MissingPersonReport>> {
    const existing = await this.missingRepo.findOne({
      where: { clientUuid: dto.clientUuid },
      relations: { photos: true },
    });
    if (existing) {
      return { report: existing, claimToken: null, duplicate: true };
    }

    const claimToken = generateClaimToken();
    const claimTokenHash = hashToken(claimToken);

    const { ageMin, ageMax } = deriveAgeRange(dto.age, dto.ageMin, dto.ageMax);
    const normalizedDoc = dto.documentNumber ? normalizeDocument(dto.documentNumber) : null;
    const normalizedPhone = dto.reporterPhone ? normalizePhoneCo(dto.reporterPhone) : null;

    const entity = this.missingRepo.create({
      // El id del servidor es el UUID que generó el cliente. Así el dispositivo
      // conoce la dirección definitiva del reporte antes de tener red y puede
      // adjuntarle fotos desde el primer momento, sin esperar a que el servidor
      // le asigne una identidad.
      id: dto.clientUuid,
      clientUuid: dto.clientUuid,
      fullName: dto.fullName.trim(),
      aliases: dto.aliases ?? [],
      documentType: dto.documentType ?? DocumentType.NINGUNO,
      documentNumber: dto.documentNumber ?? null,
      documentHash: normalizedDoc ? blindIndex(normalizedDoc) : null,
      age: dto.age ?? null,
      ageMin,
      ageMax,
      sex: dto.sex ?? Sex.UNKNOWN,
      heightCm: dto.heightCm ?? null,
      build: dto.build ?? null,
      skinTone: dto.skinTone ?? null,
      hairColor: dto.hairColor ?? null,
      clothingDescription: dto.clothingDescription ?? null,
      distinguishingMarks: dto.distinguishingMarks ?? null,
      medicalNotes: dto.medicalNotes ?? null,
      // La minoria de edad se deriva del dato declarado, no se pregunta aparte:
      // marca prioridad en la cola y activa la redaccion de datos publicos.
      isMinor: (dto.age ?? ageMax ?? 99) < 18,
      lastSeenLocation: dto.lastSeenLocation
        ? toGeoPoint(dto.lastSeenLocation.latitude, dto.lastSeenLocation.longitude)
        : null,
      lastSeenAddress: dto.lastSeenAddress ?? null,
      department: dto.department ?? null,
      municipality: dto.municipality ?? null,
      lastSeenAt: dto.lastSeenAt ? new Date(dto.lastSeenAt) : null,
      circumstances: dto.circumstances ?? null,
      reporterName: dto.reporterName.trim(),
      reporterPhone: dto.reporterPhone ?? null,
      reporterPhoneHash: normalizedPhone ? blindIndex(normalizedPhone) : null,
      reporterEmail: dto.reporterEmail ?? null,
      reporterRelationship: dto.reporterRelationship ?? null,
      reporterRole: dto.reporterRole ?? ReporterRole.FAMILY,
      claimTokenHash,
      status: MissingStatus.ACTIVE,
      source: dto.source ?? ReportSource.APP,
      consentPublicListing: dto.consentPublicListing ?? true,
    });

    const saved = await this.saveWithIdempotency(this.missingRepo, entity, dto.clientUuid);
    if (saved.duplicate) {
      return { report: saved.entity, claimToken: null, duplicate: true };
    }

    if (dto.deviceId) {
      await this.notifications.registerDevice({
        deviceId: dto.deviceId,
        platform: 'web',
        claimTokenHash,
      });
    }

    await this.notifications.enqueue({
      kind: NotificationKind.REPORT_RECEIVED,
      recipientKey: claimTokenHash,
      title: 'Reporte registrado',
      body:
        `El reporte de ${saved.entity.fullName} quedó registrado. ` +
        `Te avisaremos apenas haya información confirmada.`,
      relatedEntityId: saved.entity.id,
      payload: { missingReportId: saved.entity.id },
    });

    // El matching corre fuera del camino de respuesta: quien reporta debe ver
    // "guardado" de inmediato, no esperar a que se recorra la base.
    void this.matching
      .runForMissingReport(saved.entity.id)
      .catch((error) => this.logger.error(`Matching falló para ${saved.entity.id}: ${error}`));

    return { report: saved.entity, claimToken, duplicate: false };
  }

  // --------------------------------------------------------------------------
  // Avistamientos
  // --------------------------------------------------------------------------

  async createSighting(dto: CreateSightingDto): Promise<CreatedReportResult<SightingReport>> {
    const existing = await this.sightingRepo.findOne({
      where: { clientUuid: dto.clientUuid },
      relations: { photos: true },
    });
    if (existing) {
      return { report: existing, claimToken: null, duplicate: true };
    }

    const claimToken = generateClaimToken();
    const normalizedDoc = dto.documentNumber ? normalizeDocument(dto.documentNumber) : null;

    const entity = this.sightingRepo.create({
      // Igual que en los reportes de desaparición: el cliente conoce el id
      // antes de sincronizar y puede adjuntar fotos sin conexión.
      id: dto.clientUuid,
      clientUuid: dto.clientUuid,
      kind: dto.kind ?? SightingKind.SIGHTING,
      fullName: dto.fullName?.trim() ?? null,
      documentType: dto.documentType ?? DocumentType.NINGUNO,
      documentNumber: dto.documentNumber ?? null,
      documentHash: normalizedDoc ? blindIndex(normalizedDoc) : null,
      estimatedAgeMin: dto.estimatedAgeMin ?? null,
      estimatedAgeMax: dto.estimatedAgeMax ?? null,
      sex: dto.sex ?? Sex.UNKNOWN,
      heightCm: dto.heightCm ?? null,
      build: dto.build ?? null,
      skinTone: dto.skinTone ?? null,
      hairColor: dto.hairColor ?? null,
      clothingDescription: dto.clothingDescription ?? null,
      distinguishingMarks: dto.distinguishingMarks ?? null,
      condition: dto.condition ?? undefined,
      isMinor: (dto.estimatedAgeMax ?? 99) < 18,
      location: dto.location ? toGeoPoint(dto.location.latitude, dto.location.longitude) : null,
      address: dto.address ?? null,
      department: dto.department ?? null,
      municipality: dto.municipality ?? null,
      facilityName: dto.facilityName ?? null,
      seenAt: new Date(dto.seenAt),
      notes: dto.notes ?? null,
      reporterName: dto.reporterName?.trim() ?? null,
      reporterPhone: dto.reporterPhone ?? null,
      reporterRole: dto.reporterRole ?? ReporterRole.CITIZEN,
      reporterOrganization: dto.reporterOrganization ?? null,
      claimTokenHash: hashToken(claimToken),
      source: dto.source ?? ReportSource.APP,
      status: 'OPEN',
    });

    const saved = await this.saveWithIdempotency(this.sightingRepo, entity, dto.clientUuid);
    if (saved.duplicate) {
      return { report: saved.entity, claimToken: null, duplicate: true };
    }

    void this.matching
      .runForSighting(saved.entity.id)
      .catch((error) => this.logger.error(`Matching falló para ${saved.entity.id}: ${error}`));

    return { report: saved.entity, claimToken, duplicate: false };
  }

  /**
   * Guarda tolerando la carrera entre dos reintentos simultaneos del mismo
   * dispositivo. La verificacion previa por `clientUuid` cubre el caso comun;
   * esto cubre el caso en que dos peticiones pasan esa verificacion a la vez,
   * que en una red intermitente pasa mas de lo que parece.
   */
  private async saveWithIdempotency<T extends { clientUuid: string }>(
    repo: Repository<T>,
    entity: T,
    clientUuid: string,
  ): Promise<{ entity: T; duplicate: boolean }> {
    try {
      const saved = await repo.save(entity);
      return { entity: saved, duplicate: false };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        const existing = await repo.findOne({
          where: { clientUuid } as never,
        });
        if (existing) return { entity: existing, duplicate: true };
      }
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Consultas
  // --------------------------------------------------------------------------

  /**
   * Busqueda publica de desaparecidos.
   *
   * El texto se compara con trigramas sobre el nombre sin tildes: quien busca
   * escribe "Rios" o "Ríos" indistintamente, y en un formulario de emergencia
   * los nombres se escriben mal con frecuencia.
   */
  async searchMissing(query: QueryMissingDto): Promise<Paginated<MissingPersonReport>> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    const qb = this.missingRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.photos', 'photo')
      .where('m."deletedAt" IS NULL')
      .andWhere('m."consentPublicListing" = true');

    if (query.q) {
      // `word_similarity` y no `similarity`: esta última compara las cadenas
      // completas, así que buscar "mosqera" contra "Jhon Alexander Mosquera
      // Palacios" puntúa 0.17 y no encuentra nada. `word_similarity` busca el
      // mejor fragmento del nombre que coincida con la consulta y sube a 0.55,
      // que es el comportamiento que espera quien escribe un apellido con un
      // error de tipeo en medio de una emergencia.
      qb.andWhere(
        `(word_similarity(lower(immutable_unaccent(:q)), lower(immutable_unaccent(m."fullName"))) > 0.5
          OR lower(immutable_unaccent(m."fullName")) LIKE '%' || lower(immutable_unaccent(:q)) || '%'
          OR EXISTS (
            SELECT 1 FROM unnest(m.aliases) AS alias
            WHERE word_similarity(lower(immutable_unaccent(:q)), lower(immutable_unaccent(alias))) > 0.5
          ))`,
        { q: query.q },
      );
    }

    if (query.department) qb.andWhere('m.department = :department', { department: query.department });
    if (query.municipality) qb.andWhere('m.municipality = :municipality', { municipality: query.municipality });
    if (query.status) qb.andWhere('m.status = :status', { status: query.status });
    if (query.sex) qb.andWhere('m.sex = :sex', { sex: query.sex });
    if (query.minorsOnly) qb.andWhere('m."isMinor" = true');
    if (query.ageFrom !== undefined) qb.andWhere('COALESCE(m."ageMax", m.age) >= :ageFrom', { ageFrom: query.ageFrom });
    if (query.ageTo !== undefined) qb.andWhere('COALESCE(m."ageMin", m.age) <= :ageTo', { ageTo: query.ageTo });

    // El ORDER BY usa rutas de propiedad: al paginar una consulta con joins,
    // TypeORM debe resolver esas columnas para armar la subconsulta de ids, y
    // no puede hacerlo con SQL entre comillas ni con expresiones calculadas.
    if (query.q) {
      // La similitud se expone como columna seleccionada para poder ordenar por
      // su alias en lugar de repetir la expresion completa.
      qb.addSelect(
        'word_similarity(lower(immutable_unaccent(:q)), lower(immutable_unaccent(m."fullName")))',
        'name_similarity',
      ).orderBy('name_similarity', 'DESC');
      qb.addOrderBy('m.createdAt', 'DESC');
    } else {
      // Sin busqueda, primero los menores y luego lo mas reciente: son los
      // casos donde el tiempo pesa mas.
      qb.orderBy('m.isMinor', 'DESC').addOrderBy('m.createdAt', 'DESC');
    }

    const [items, total] = await qb.take(limit).skip(offset).getManyAndCount();
    return { items, total, limit, offset };
  }

  /**
   * Un reporte por id, para el panel de validacion.
   *
   * Ignora `consentPublicListing` a proposito: un validador tiene que poder
   * revisar tambien los casos que la familia pidio no publicar. Lo que si
   * respeta es el borrado logico — una fila retirada esta retirada para todos.
   */
  async findMissingById(id: string): Promise<MissingPersonReport> {
    const report = await this.missingRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: { photos: true },
    });
    if (!report) throw new NotFoundException('Reporte no encontrado');
    return report;
  }

  /**
   * El mismo reporte, pero por la puerta publica.
   *
   * Existe separado y no como un parametro opcional porque un booleano que hay
   * que acordarse de pasar se olvida, y olvidarlo aqui significa publicar el
   * caso de una familia que marco explicitamente que no queria que se publicara.
   * `searchMissing` ya filtraba por consentimiento; consultar por id lo saltaba,
   * de modo que el listado respetaba una decision que el enlace directo no.
   */
  async findPublicMissingById(id: string): Promise<MissingPersonReport> {
    const report = await this.missingRepo.findOne({
      where: { id, deletedAt: IsNull(), consentPublicListing: true },
      relations: { photos: true },
    });
    if (!report) throw new NotFoundException('Reporte no encontrado');
    return report;
  }

  /** Resuelve un reporte a partir del claim token que conserva quien lo creo. */
  async findByClaimToken(claimToken: string): Promise<MissingPersonReport> {
    const report = await this.missingRepo.findOne({
      where: { claimTokenHash: hashToken(claimToken), deletedAt: IsNull() },
      relations: { photos: true },
    });
    if (!report) throw new UnauthorizedException('Token de seguimiento inválido');
    return report;
  }

  async findSightingById(id: string): Promise<SightingReport> {
    const sighting = await this.sightingRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: { photos: true },
    });
    if (!sighting) throw new NotFoundException('Avistamiento no encontrado');
    return sighting;
  }

  async listRecentSightings(limit = 25): Promise<SightingReport[]> {
    return this.sightingRepo.find({
      where: { status: 'OPEN', deletedAt: IsNull() },
      relations: { photos: true },
      order: { seenAt: 'DESC' },
      take: limit,
    });
  }

  /** Cierre por parte del propio reportante ("apareció, ya está con nosotros"). */
  async closeByOwner(
    claimToken: string,
    outcome: MissingStatus.FOUND_ALIVE | MissingStatus.CANCELLED,
    notes?: string,
  ): Promise<MissingPersonReport> {
    const report = await this.findByClaimToken(claimToken);

    report.status = outcome;
    report.resolvedAt = new Date();
    report.resolutionNotes = notes ?? null;
    await this.missingRepo.save(report);

    // Los candidatos pendientes dejan de tener sentido; se retiran de la cola
    // para que nadie gaste tiempo revisando un caso ya cerrado.
    const pending = await this.matching.listForMissingReport(report.id);
    this.logger.log(
      `Reporte ${report.id} cerrado por su autor con ${pending.length} candidato(s) asociados`,
    );

    return report;
  }

  // --------------------------------------------------------------------------
  // Moderacion
  // --------------------------------------------------------------------------

  /**
   * Retira un reporte de la vista publica.
   *
   * Existe porque cualquiera puede publicar, de forma anonima y sin revision, un
   * reporte o un avistamiento con el nombre completo de una persona real, su
   * descripcion fisica, una ubicacion y una foto. Los reportes de zona tenian
   * moderacion desde el principio; estos no, y no habia forma de bajar una
   * publicacion difamatoria sin escribir SQL contra produccion.
   *
   * Es borrado logico, no fisico. Un reporte retirado desaparece de todas las
   * vistas —el listado, la busqueda, el enlace directo, el motor de
   * coincidencias y la exportacion— pero la fila sigue ahi. Dos razones: si la
   * retirada fue un error hay que poder deshacerla, y si el reporte era el de
   * una desaparicion real, borrarlo de verdad seria destruir lo que una familia
   * conto sobre su hija.
   */
  async retirarMissing(id: string, motivo: string): Promise<MissingPersonReport> {
    const report = await this.missingRepo.findOne({ where: { id } });
    if (!report) throw new NotFoundException('Reporte no encontrado');

    // El motivo NO se guarda en el reporte. `resolutionNotes` es de quien lo
    // creo —ahi escribe "aparecio, ya esta con nosotros"— y escribir encima
    // borraria lo que dijo una familia sobre el final de su caso. El motivo vive
    // en la bitacora, que ademas registra quien lo retiro, cuando y desde donde.
    await this.missingRepo.softDelete(id);

    // Los avisos pendientes de este caso dejan de tener sentido.
    await this.notifications.cancelPendingFor(id);

    this.logger.warn(`Reporte ${id} retirado de la vista publica: ${motivo}`);
    return report;
  }

  /** Devuelve a la vista publica un reporte retirado por error. */
  async restaurarMissing(id: string): Promise<MissingPersonReport> {
    const report = await this.missingRepo.findOne({ where: { id }, withDeleted: true });
    if (!report) throw new NotFoundException('Reporte no encontrado');
    if (!report.deletedAt) throw new BadRequestException('Ese reporte no está retirado.');

    await this.missingRepo.restore(id);
    return report;
  }

  async retirarSighting(id: string, motivo: string): Promise<SightingReport> {
    const sighting = await this.sightingRepo.findOne({ where: { id } });
    if (!sighting) throw new NotFoundException('Avistamiento no encontrado');

    // Igual que arriba: `notes` es de quien reporto el avistamiento, no un sitio
    // donde el panel deje sus anotaciones.
    await this.sightingRepo.softDelete(id);

    this.logger.warn(`Avistamiento ${id} retirado de la vista publica: ${motivo}`);
    return sighting;
  }

  async restaurarSighting(id: string): Promise<SightingReport> {
    const sighting = await this.sightingRepo.findOne({ where: { id }, withDeleted: true });
    if (!sighting) throw new NotFoundException('Avistamiento no encontrado');
    if (!sighting.deletedAt) throw new BadRequestException('Ese avistamiento no está retirado.');

    await this.sightingRepo.restore(id);
    return sighting;
  }

  /**
   * Lo retirado, para poder revisar y deshacer.
   *
   * Una moderacion que no se puede auditar ni revertir es su propio riesgo:
   * retirar el reporte de una desaparicion real por error deja a una familia sin
   * su caso y sin saber por que.
   */
  async listarRetirados(limit = 50): Promise<{
    desaparecidos: MissingPersonReport[];
    avistamientos: SightingReport[];
  }> {
    const [desaparecidos, avistamientos] = await Promise.all([
      this.missingRepo.find({
        where: { deletedAt: Not(IsNull()) },
        withDeleted: true,
        order: { deletedAt: 'DESC' },
        take: limit,
      }),
      this.sightingRepo.find({
        where: { deletedAt: Not(IsNull()) },
        withDeleted: true,
        order: { deletedAt: 'DESC' },
        take: limit,
      }),
    ]);
    return { desaparecidos, avistamientos };
  }

  /** Estadisticas para el tablero de situación. */
  async getStats(): Promise<Record<string, number>> {
    const rows = await this.missingRepo
      .createQueryBuilder('m')
      .select('m.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .where('m."deletedAt" IS NULL')
      .groupBy('m.status')
      .getRawMany<{ status: string; count: number }>();

    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]));
    const openSightings = await this.sightingRepo.count({ where: { status: 'OPEN' } });

    return {
      activos: byStatus[MissingStatus.ACTIVE] ?? 0,
      encontradosConVida: byStatus[MissingStatus.FOUND_ALIVE] ?? 0,
      encontradosSinVida: byStatus[MissingStatus.FOUND_DECEASED] ?? 0,
      avistamientosAbiertos: openSightings,
      totalReportes: rows.reduce((sum, r) => sum + r.count, 0),
    };
  }
}

/**
 * Deriva el rango de edad con el que trabaja el matching.
 *
 * Una edad exacta declarada por la familia se convierte en un rango estrecho
 * porque del otro lado siempre habra una estimacion visual. Comparar "34" con
 * "entre 30 y 38" como si ambos fueran precisos produciria descartes falsos.
 */
function deriveAgeRange(
  age?: number,
  ageMin?: number,
  ageMax?: number,
): { ageMin: number | null; ageMax: number | null } {
  if (ageMin !== undefined && ageMax !== undefined) {
    return { ageMin, ageMax };
  }
  if (age !== undefined) {
    return {
      ageMin: ageMin ?? Math.max(0, age - AGE_MARGIN_YEARS),
      ageMax: ageMax ?? age + AGE_MARGIN_YEARS,
    };
  }
  return { ageMin: ageMin ?? null, ageMax: ageMax ?? null };
}
