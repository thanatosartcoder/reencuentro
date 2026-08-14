import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { GeoPoint } from 'src/common/geo/geo.util';
import { MissingPersonReport } from '../entities/missing-person-report.entity';
import { SightingReport } from '../entities/sighting-report.entity';
import { MatchCandidate } from '../entities/match-candidate.entity';
import { PersonPhoto } from '../entities/person-photo.entity';
import { MatchStatus, MatchTier, MissingStatus, PersonCondition, Sex } from '../persons.enums';
import { MatchSubject, scoreMatch } from './scoring';
import { NotificationsService } from 'src/modules/notifications/notifications.service';
import { NotificationKind } from 'src/modules/notifications/notifications.enums';
import { RealtimeGateway } from 'src/modules/notifications/realtime.gateway';
import { AuditService } from 'src/modules/audit/audit.service';

/** Cuantos reportes se traen como maximo para puntuar en memoria. */
const CANDIDATE_FETCH_LIMIT = 400;

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    @InjectRepository(MissingPersonReport)
    private readonly missingRepo: Repository<MissingPersonReport>,
    @InjectRepository(SightingReport)
    private readonly sightingRepo: Repository<SightingReport>,
    @InjectRepository(MatchCandidate)
    private readonly candidateRepo: Repository<MatchCandidate>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly gateway: RealtimeGateway,
    private readonly audit: AuditService,
  ) {}

  private get minScore(): number {
    return this.config.get<number>('matching.minScore') ?? 0.55;
  }

  private get highScore(): number {
    return this.config.get<number>('matching.highScore') ?? 0.8;
  }

  private get radiusMeters(): number {
    return this.config.get<number>('matching.searchRadiusMeters') ?? 50_000;
  }

  // --------------------------------------------------------------------------
  // Construccion de sujetos comparables
  // --------------------------------------------------------------------------

  private missingToSubject(report: MissingPersonReport): MatchSubject {
    // Cuando la familia da una edad exacta se convierte en un rango estrecho:
    // del otro lado siempre hay una estimacion, nunca un dato exacto.
    const ageMin = report.ageMin ?? (report.age !== null ? report.age - 3 : null);
    const ageMax = report.ageMax ?? (report.age !== null ? report.age + 3 : null);

    return {
      fullName: report.fullName,
      documentHash: report.documentHash,
      ageMin,
      ageMax,
      sex: report.sex,
      heightCm: report.heightCm,
      build: report.build,
      skinTone: report.skinTone,
      hairColor: report.hairColor,
      distinguishingMarks: report.distinguishingMarks,
      location: report.lastSeenLocation,
      at: report.lastSeenAt,
      faceDescriptors: descriptorsOf(report.photos),
    };
  }

  private sightingToSubject(sighting: SightingReport): MatchSubject {
    return {
      fullName: sighting.fullName,
      documentHash: sighting.documentHash,
      ageMin: sighting.estimatedAgeMin,
      ageMax: sighting.estimatedAgeMax,
      sex: sighting.sex,
      heightCm: sighting.heightCm,
      build: sighting.build,
      skinTone: sighting.skinTone,
      hairColor: sighting.hairColor,
      distinguishingMarks: sighting.distinguishingMarks,
      location: sighting.location,
      at: sighting.seenAt,
      faceDescriptors: descriptorsOf(sighting.photos),
    };
  }

  // --------------------------------------------------------------------------
  // Recuperacion de candidatos
  // --------------------------------------------------------------------------

  /**
   * Trae los reportes de desaparicion que vale la pena puntuar contra un
   * avistamiento.
   *
   * Puntuar contra la tabla entera no escala y tampoco hace falta: un
   * candidato plausible comparte documento, esta geograficamente cerca, o al
   * menos cae en el mismo departamento. El prefiltro se hace en Postgres con
   * los indices espaciales y trigram; el scoring fino se hace en memoria sobre
   * un conjunto acotado.
   */
  private async fetchMissingCandidates(sighting: SightingReport): Promise<MissingPersonReport[]> {
    const qb = this.missingRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.photos', 'photo')
      .where('m."deletedAt" IS NULL')
      .andWhere('m.status = :status', { status: MissingStatus.ACTIVE });

    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (sighting.documentHash) {
      conditions.push('m."documentHash" = :docHash');
      params.docHash = sighting.documentHash;
    }

    if (sighting.location) {
      conditions.push(
        `ST_DWithin(m."lastSeenLocation", ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radius)`,
      );
      params.lon = sighting.location.coordinates[0];
      params.lat = sighting.location.coordinates[1];
      params.radius = this.radiusMeters;
    }

    if (sighting.department) {
      // Red de seguridad para reportes sin coordenada: en zonas sin senal el
      // GPS tampoco fija, y el departamento suele ser lo unico que hay.
      conditions.push('m.department = :dept');
      params.dept = sighting.department;
    }

    if (sighting.fullName) {
      // Un nombre parecido justifica revisar aunque la persona haya sido
      // trasladada lejos del punto donde desaparecio.
      conditions.push(
        `similarity(lower(immutable_unaccent(m."fullName")), lower(immutable_unaccent(:name))) > 0.3`,
      );
      params.name = sighting.fullName;
    }

    if (!conditions.length) {
      // Sin documento, sin ubicacion, sin departamento y sin nombre no hay por
      // donde acotar; puntuar contra todo produciria ruido, no matches.
      return [];
    }

    qb.andWhere(`(${conditions.join(' OR ')})`, params);

    // El sexo se filtra solo cuando ambos lados lo declaran: descartar los
    // UNKNOWN dejaria fuera precisamente a las personas encontradas
    // inconscientes, que es donde el sistema mas hace falta.
    if (sighting.sex !== Sex.UNKNOWN) {
      qb.andWhere('(m.sex = :sex OR m.sex = :unknown)', {
        sex: sighting.sex,
        unknown: Sex.UNKNOWN,
      });
    }

    return qb.limit(CANDIDATE_FETCH_LIMIT).getMany();
  }

  /** Espejo del anterior: avistamientos abiertos que valen la pena para un reporte nuevo. */
  private async fetchSightingCandidates(report: MissingPersonReport): Promise<SightingReport[]> {
    const qb = this.sightingRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.photos', 'photo')
      .where('s."deletedAt" IS NULL')
      .andWhere("s.status = 'OPEN'");

    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (report.documentHash) {
      conditions.push('s."documentHash" = :docHash');
      params.docHash = report.documentHash;
    }

    if (report.lastSeenLocation) {
      conditions.push(
        `ST_DWithin(s."location", ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radius)`,
      );
      params.lon = report.lastSeenLocation.coordinates[0];
      params.lat = report.lastSeenLocation.coordinates[1];
      params.radius = this.radiusMeters;
    }

    if (report.department) {
      conditions.push('s.department = :dept');
      params.dept = report.department;
    }

    conditions.push(
      `(s."fullName" IS NOT NULL AND similarity(lower(immutable_unaccent(s."fullName")), lower(immutable_unaccent(:name))) > 0.3)`,
    );
    params.name = report.fullName;

    qb.andWhere(`(${conditions.join(' OR ')})`, params);

    if (report.sex !== Sex.UNKNOWN) {
      qb.andWhere('(s.sex = :sex OR s.sex = :unknown)', {
        sex: report.sex,
        unknown: Sex.UNKNOWN,
      });
    }

    return qb.limit(CANDIDATE_FETCH_LIMIT).getMany();
  }

  // --------------------------------------------------------------------------
  // Generacion de candidatos
  // --------------------------------------------------------------------------

  /** Corre el motor para un avistamiento recien creado. */
  async runForSighting(sightingId: string): Promise<MatchCandidate[]> {
    const sighting = await this.sightingRepo.findOne({
      where: { id: sightingId },
      relations: { photos: true },
    });
    if (!sighting) return [];

    const candidates = await this.fetchMissingCandidates(sighting);
    const sightingSubject = this.sightingToSubject(sighting);

    const created = await this.scoreAndPersist(
      candidates.map((missing) => ({
        missing,
        sighting,
        result: scoreMatch(this.missingToSubject(missing), sightingSubject),
      })),
    );

    await this.sightingRepo.update(sighting.id, { matchedAt: new Date() });
    return created;
  }

  /** Corre el motor para un reporte de desaparicion recien creado. */
  async runForMissingReport(missingId: string): Promise<MatchCandidate[]> {
    const missing = await this.missingRepo.findOne({
      where: { id: missingId },
      relations: { photos: true },
    });
    if (!missing) return [];

    const sightings = await this.fetchSightingCandidates(missing);
    const missingSubject = this.missingToSubject(missing);

    return this.scoreAndPersist(
      sightings.map((sighting) => ({
        missing,
        sighting,
        result: scoreMatch(missingSubject, this.sightingToSubject(sighting)),
      })),
    );
  }

  private async scoreAndPersist(
    scored: {
      missing: MissingPersonReport;
      sighting: SightingReport;
      result: ReturnType<typeof scoreMatch>;
    }[],
  ): Promise<MatchCandidate[]> {
    const above = scored.filter((s) => s.result.score >= this.minScore);
    if (!above.length) return [];

    const persisted: MatchCandidate[] = [];

    for (const { missing, sighting, result } of above) {
      const highPriority =
        result.score >= this.highScore ||
        result.tier === MatchTier.DETERMINISTIC ||
        // Un estado critico o un menor de edad se revisan primero aunque el
        // score sea moderado: ahi el tiempo de espera tiene un costo distinto.
        sighting.condition === PersonCondition.CRITICAL ||
        missing.isMinor;

      // Se reescribe el score si el candidato sigue pendiente, pero jamas si un
      // humano ya decidio: una re-ejecucion del motor no puede deshacer una
      // revision.
      const upsert = await this.candidateRepo
        .createQueryBuilder()
        .insert()
        .into(MatchCandidate)
        .values({
          missingReportId: missing.id,
          sightingReportId: sighting.id,
          score: result.score,
          tier: result.tier,
          breakdown: result.breakdown,
          status: MatchStatus.PENDING_REVIEW,
          highPriority,
        })
        .orUpdate(
          ['score', 'tier', 'breakdown', 'highPriority'],
          ['missingReportId', 'sightingReportId'],
          { skipUpdateIfNoValuesChanged: true },
        )
        .setParameter('pendingStatus', MatchStatus.PENDING_REVIEW)
        .returning('*')
        .execute();

      const row = upsert.raw?.[0];
      if (row) persisted.push(row as MatchCandidate);
    }

    if (persisted.length) {
      // Se avisa a la cola de validadores, no a las familias. Notificar un
      // candidato sin revisar equivale a decirle a alguien "puede que hayamos
      // encontrado a su hija"; si luego resulta que no, el dano ya esta hecho.
      this.gateway.emitToOperators('queue:new-candidates', {
        count: persisted.length,
        highPriority: persisted.filter((c) => c.highPriority).length,
      });
      this.logger.log(`${persisted.length} candidato(s) encolado(s) para revisión humana`);
    }

    return persisted;
  }

  // --------------------------------------------------------------------------
  // Revision humana
  // --------------------------------------------------------------------------

  async listPendingQueue(options: {
    limit?: number;
    offset?: number;
    onlyHighPriority?: boolean;
  }): Promise<{ items: MatchCandidate[]; total: number }> {
    const qb = this.candidateRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.missingReport', 'm')
      .leftJoinAndSelect('m.photos', 'mp')
      .leftJoinAndSelect('c.sightingReport', 's')
      .leftJoinAndSelect('s.photos', 'sp')
      .where('c.status = :status', { status: MatchStatus.PENDING_REVIEW });

    if (options.onlyHighPriority) {
      qb.andWhere('c."highPriority" = true');
    }

    // Rutas de propiedad y no SQL entre comillas: al paginar sobre una consulta
    // con joins, TypeORM tiene que resolver las columnas del ORDER BY para
    // construir la subconsulta de ids, y una expresion cruda no puede mapearla.
    const [items, total] = await qb
      .orderBy('c.highPriority', 'DESC')
      .addOrderBy('c.score', 'DESC')
      .addOrderBy('c.createdAt', 'ASC')
      .take(options.limit ?? 25)
      .skip(options.offset ?? 0)
      .getManyAndCount();

    return { items, total };
  }

  /**
   * Confirma un match.
   *
   * Es el unico camino por el que sale una notificacion a la familia, y todo
   * ocurre en una transaccion: se marca el candidato, se cierra el reporte, se
   * resuelve el avistamiento, se descartan los candidatos rivales y se escribe
   * la notificacion en el outbox. O pasa todo o no pasa nada.
   */
  async confirm(
    candidateId: string,
    operator: { id: string; name: string },
    notes?: string,
  ): Promise<MatchCandidate> {
    return this.dataSource.transaction(async (manager) => {
      const candidate = await manager.findOne(MatchCandidate, {
        where: { id: candidateId },
        relations: { missingReport: true, sightingReport: true },
      });

      if (!candidate) throw new NotFoundException('Candidato de match no encontrado');
      if (candidate.status !== MatchStatus.PENDING_REVIEW) {
        throw new BadRequestException(
          `El candidato ya fue revisado (estado actual: ${candidate.status})`,
        );
      }

      const now = new Date();
      const sighting = candidate.sightingReport;
      const missing = candidate.missingReport;

      candidate.status = MatchStatus.CONFIRMED;
      candidate.reviewedById = operator.id;
      candidate.reviewedByName = operator.name;
      candidate.reviewedAt = now;
      candidate.reviewNotes = notes ?? null;
      candidate.notifiedAt = now;
      await manager.save(candidate);

      // El desenlace del avistamiento define como se cierra el caso: encontrada
      // con vida o fallecida. La distincion cambia por completo el mensaje.
      const deceased = sighting.condition === PersonCondition.DECEASED;
      await manager.update(MissingPersonReport, missing.id, {
        status: deceased ? MissingStatus.FOUND_DECEASED : MissingStatus.FOUND_ALIVE,
        resolvedAt: now,
        resolutionNotes: notes ?? null,
      });
      await manager.update(SightingReport, sighting.id, { status: 'RESOLVED' });

      // Los demas candidatos del mismo reporte pierden vigencia: la persona ya
      // aparecio. Se marcan como superados, no como rechazados, porque nadie
      // los evaluo.
      await manager
        .createQueryBuilder()
        .update(MatchCandidate)
        .set({ status: MatchStatus.SUPERSEDED })
        .where('"missingReportId" = :missingId', { missingId: missing.id })
        .andWhere('id != :id', { id: candidate.id })
        .andWhere('status = :pending', { pending: MatchStatus.PENDING_REVIEW })
        .execute();

      const { title, body } = buildConfirmationMessage(missing.fullName, sighting, deceased);

      await this.notifications.enqueue(
        {
          kind: NotificationKind.MATCH_CONFIRMED,
          recipientKey: missing.claimTokenHash,
          title,
          body,
          relatedEntityId: candidate.id,
          payload: {
            missingReportId: missing.id,
            sightingReportId: sighting.id,
            matchId: candidate.id,
            facilityName: sighting.facilityName,
            municipality: sighting.municipality,
            department: sighting.department,
            condition: sighting.condition,
            confirmedBy: operator.name,
          },
        },
        manager,
      );

      await this.audit.record(
        {
          actorId: operator.id,
          actorName: operator.name,
          action: 'CONFIRM_MATCH',
          entityType: 'MatchCandidate',
          entityId: candidate.id,
          metadata: {
            score: candidate.score,
            tier: candidate.tier,
            missingReportId: missing.id,
            sightingReportId: sighting.id,
          },
        },
        manager,
      );

      return candidate;
    });
  }

  async reject(
    candidateId: string,
    operator: { id: string; name: string },
    notes?: string,
  ): Promise<MatchCandidate> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId } });
    if (!candidate) throw new NotFoundException('Candidato de match no encontrado');
    if (candidate.status !== MatchStatus.PENDING_REVIEW) {
      throw new BadRequestException(
        `El candidato ya fue revisado (estado actual: ${candidate.status})`,
      );
    }

    candidate.status = MatchStatus.REJECTED;
    candidate.reviewedById = operator.id;
    candidate.reviewedByName = operator.name;
    candidate.reviewedAt = new Date();
    candidate.reviewNotes = notes ?? null;
    await this.candidateRepo.save(candidate);

    // Un rechazo no se notifica a la familia. Nunca se les dijo que habia un
    // candidato, asi que no hay nada que desmentir.
    await this.audit.record({
      actorId: operator.id,
      actorName: operator.name,
      action: 'REJECT_MATCH',
      entityType: 'MatchCandidate',
      entityId: candidate.id,
      metadata: { score: candidate.score, notes },
    });

    return candidate;
  }

  async listForMissingReport(missingReportId: string): Promise<MatchCandidate[]> {
    return this.candidateRepo.find({
      where: { missingReportId },
      relations: { sightingReport: true },
      order: { score: 'DESC' },
    });
  }
}

function descriptorsOf(photos: PersonPhoto[] | undefined): number[][] {
  return (photos ?? [])
    .map((p) => p.faceDescriptor)
    .filter((d): d is number[] => Array.isArray(d) && d.length > 0);
}

/**
 * Redaccion del aviso.
 *
 * Nadie deberia enterarse por una notificacion push de que un familiar murio.
 * Cuando el desenlace es un fallecimiento el mensaje no lo dice: informa que
 * hay novedades confirmadas y pide contacto con la entidad, para que la noticia
 * la de una persona.
 */
function buildConfirmationMessage(
  fullName: string,
  sighting: SightingReport,
  deceased: boolean,
): { title: string; body: string } {
  const place =
    sighting.facilityName ??
    [sighting.municipality, sighting.department].filter(Boolean).join(', ') ??
    'una ubicación registrada';

  if (deceased) {
    return {
      title: 'Novedad confirmada sobre tu reporte',
      body:
        `Hay información confirmada sobre ${fullName}. ` +
        `Por favor comunícate cuanto antes con el punto de atención en ${place}. ` +
        `Un funcionario te dará los detalles personalmente.`,
    };
  }

  // Redaccion sin marca de genero: el sistema no conoce el genero de la
  // persona (solo un campo de sexo que muchas veces llega vacio o estimado por
  // un tercero), y equivocarlo en el mensaje que anuncia su aparicion seria
  // una falta de respeto gratuita justo en ese momento.
  return {
    title: `Localizamos a ${fullName}`,
    body:
      `Un validador confirmó que ${fullName} se encuentra en ${place}. ` +
      `Abre la aplicación para ver los detalles y los datos de contacto.`,
  };
}
