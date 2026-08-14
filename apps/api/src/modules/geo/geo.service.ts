import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, Repository } from 'typeorm';
import { parseBbox, toGeoPoint } from 'src/common/geo/geo.util';
import { ReporterRole } from 'src/modules/persons/persons.enums';
import { RealtimeGateway } from 'src/modules/notifications/realtime.gateway';
import { ZoneReport } from './entities/zone-report.entity';
import { ZoneReportVote } from './entities/zone-report-vote.entity';
import { VoteKind, ZONE_TYPE_CONFIG, ZoneReportStatus, ZoneReportType } from './geo.enums';
import { CreateZoneReportDto, VoteZoneReportDto } from './dto/create-zone-report.dto';
import { NearbyZonesDto, QueryZonesDto } from './dto/query-zones.dto';

/** Confianza inicial según quién reporta. Un rescatista no vale lo mismo que un anónimo. */
export const ROLE_BASE_CONFIDENCE: Record<ReporterRole, number> = {
  [ReporterRole.OFFICIAL]: 0.9,
  [ReporterRole.RESCUER]: 0.85,
  [ReporterRole.HEALTH_STAFF]: 0.85,
  [ReporterRole.VOLUNTEER]: 0.6,
  [ReporterRole.FAMILY]: 0.45,
  [ReporterRole.CITIZEN]: 0.4,
};

/** Aporte de cada confirmación, con tope: diez confirmaciones no dan certeza absoluta. */
const CONFIRMATION_WEIGHT = 0.12;
const MAX_CONFIRMATIONS_COUNTED = 8;

/**
 * Una refutación pesa más que una confirmación.
 *
 * La asimetría es deliberada: quien dice "esta vía ya está despejada" suele
 * haber pasado por ahí hace minutos, mientras que las confirmaciones se acumulan
 * de gente que repite lo que ya estaba en el mapa. Y el costo de los dos errores
 * no es simétrico: marcar como bloqueada una vía abierta desvía una ambulancia,
 * pero marcar como abierta una vía bloqueada la manda contra un derrumbe.
 */
const REFUTATION_WEIGHT = 0.25;

/** Por debajo de esto un reporte deja de mostrarse por defecto. */
const DEFAULT_MIN_CONFIDENCE = 0.15;

/**
 * Expresión SQL de la confianza vigente.
 *
 * Se calcula en la base y no en el servidor por dos razones: permite filtrar y
 * ordenar por confianza dentro de la misma consulta que trae los reportes, y
 * evita traer a memoria miles de filas para descartar la mayoría.
 *
 * La credibilidad se acota a [0,1] ANTES de aplicar el decaimiento, no después.
 * Si se acotara al final, un reporte oficial con ocho confirmaciones acumularía
 * una credibilidad bruta de 1.86 y seguiría mostrándose con confianza 1.0
 * durante horas, con el decaimiento enmascarado por el techo. La antigüedad
 * tiene que verse siempre.
 *
 * `prefix` permite reutilizar la misma fórmula en un SELECT con alias y en un
 * UPDATE sin alias, en vez de mantener dos copias que pueden divergir.
 */
function confidenceSql(prefix: string): string {
  return `
    GREATEST(0, LEAST(1,
      ${prefix}"baseConfidence"
        + ${CONFIRMATION_WEIGHT} * LEAST(${prefix}"confirmations", ${MAX_CONFIRMATIONS_COUNTED})
        - ${REFUTATION_WEIGHT} * ${prefix}"refutations"
    ))
    * POWER(2, -(EXTRACT(EPOCH FROM (now() - ${prefix}"lastConfirmedAt")) / 60.0) / NULLIF(${prefix}"halfLifeMinutes", 0))
  `;
}

const CONFIDENCE_SQL = confidenceSql('z.');

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(
    @InjectRepository(ZoneReport)
    private readonly zoneRepo: Repository<ZoneReport>,
    @InjectRepository(ZoneReportVote)
    private readonly voteRepo: Repository<ZoneReportVote>,
    private readonly dataSource: DataSource,
    private readonly gateway: RealtimeGateway,
  ) {}

  // --------------------------------------------------------------------------
  // Escritura
  // --------------------------------------------------------------------------

  /**
   * Crea un reporte de zona. Idempotente por `clientUuid`.
   *
   * El modelo es de eventos: nadie edita "el estado de la vía". Cada reporte es
   * una observación independiente, y por eso la sincronización offline es un
   * simple append sin conflictos que resolver. Dos personas que reportan el
   * mismo derrumbe no chocan: se refuerzan.
   */
  async createReport(dto: CreateZoneReportDto): Promise<{ report: ZoneReport; duplicate: boolean }> {
    const existing = await this.zoneRepo.findOne({ where: { clientUuid: dto.clientUuid } });
    if (existing) return { report: existing, duplicate: true };

    const config = ZONE_TYPE_CONFIG[dto.type];
    const role = dto.reporterRole ?? ReporterRole.CITIZEN;
    const reportedAt = dto.reportedAt ? new Date(dto.reportedAt) : new Date();

    if (reportedAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException('reportedAt no puede estar en el futuro');
    }

    const entity = this.zoneRepo.create({
      // El id es el UUID del cliente: el dispositivo conoce la dirección
      // definitiva del reporte antes de sincronizarlo.
      id: dto.clientUuid,
      clientUuid: dto.clientUuid,
      type: dto.type,
      location: toGeoPoint(dto.location.latitude, dto.location.longitude),
      path: dto.path ? { type: 'LineString', coordinates: dto.path } : null,
      radiusMeters: dto.radiusMeters ?? null,
      description: dto.description ?? null,
      roadName: dto.roadName ?? null,
      department: dto.department ?? null,
      municipality: dto.municipality ?? null,
      severity: dto.severity ?? config.severity,
      reportedAt,
      halfLifeMinutes: config.halfLifeMinutes,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      baseConfidence: ROLE_BASE_CONFIDENCE[role],
      confirmations: 0,
      refutations: 0,
      // El reloj de decaimiento arranca en el momento de la observación, no en
      // el de la subida: un reporte creado sin señal y sincronizado seis horas
      // después ya nace con seis horas de antigüedad.
      lastConfirmedAt: reportedAt,
      reporterRole: role,
      reporterOrganization: dto.reporterOrganization ?? null,
      deviceId: dto.deviceId,
      status: ZoneReportStatus.ACTIVE,
    });

    let saved: ZoneReport;
    try {
      saved = await this.zoneRepo.save(entity);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        const raced = await this.zoneRepo.findOne({ where: { clientUuid: dto.clientUuid } });
        if (raced) return { report: raced, duplicate: true };
      }
      throw error;
    }

    const view = await this.findById(saved.id);
    this.gateway.emitToMap('zone:created', view);

    return { report: saved, duplicate: false };
  }

  /**
   * Confirma o refuta un reporte.
   *
   * Una confirmación refresca `lastConfirmedAt`, que es lo que reinicia el
   * decaimiento: la vía sigue bloqueada porque alguien acaba de verla así, no
   * porque alguien la vio así hace ocho horas.
   */
  async vote(reportId: string, dto: VoteZoneReportDto): Promise<ZoneReport> {
    return this.dataSource.transaction(async (manager) => {
      const report = await manager.findOne(ZoneReport, { where: { id: reportId } });
      if (!report) throw new NotFoundException('Reporte de zona no encontrado');

      const previous = await manager.findOne(ZoneReportVote, {
        where: { zoneReportId: reportId, deviceId: dto.deviceId },
      });

      if (previous?.vote === dto.vote) {
        // Mismo voto repetido: no suma. Sin esto, un solo dispositivo podría
        // inflar la confianza de un reporte falso.
        return report;
      }

      const location = dto.location
        ? toGeoPoint(dto.location.latitude, dto.location.longitude)
        : null;

      if (previous) {
        // Cambio de opinión: se revierte el voto anterior antes de aplicar el nuevo.
        if (previous.vote === VoteKind.CONFIRM) report.confirmations = Math.max(0, report.confirmations - 1);
        else report.refutations = Math.max(0, report.refutations - 1);

        previous.vote = dto.vote;
        previous.location = location;
        previous.comment = dto.comment ?? null;
        previous.voterRole = dto.voterRole ?? previous.voterRole;
        await manager.save(previous);
      } else {
        await manager.save(
          manager.create(ZoneReportVote, {
            clientUuid: dto.clientUuid,
            zoneReportId: reportId,
            vote: dto.vote,
            deviceId: dto.deviceId,
            voterRole: dto.voterRole ?? ReporterRole.CITIZEN,
            location,
            comment: dto.comment ?? null,
          }),
        );
      }

      if (dto.vote === VoteKind.CONFIRM) {
        report.confirmations += 1;
        report.lastConfirmedAt = new Date();
      } else {
        report.refutations += 1;
      }

      // Suficientes refutaciones sobre confirmaciones: la situación cambió.
      if (report.refutations >= 3 && report.refutations > report.confirmations) {
        report.status = ZoneReportStatus.RESOLVED;
        report.resolutionNotes = 'Cerrado automáticamente por refutaciones de la comunidad';
      }

      const saved = await manager.save(report);
      this.gateway.emitToMap('zone:updated', {
        id: saved.id,
        confirmations: saved.confirmations,
        refutations: saved.refutations,
        status: saved.status,
      });

      return saved;
    });
  }

  async moderate(
    reportId: string,
    status: ZoneReportStatus,
    notes: string | undefined,
  ): Promise<ZoneReport> {
    const report = await this.zoneRepo.findOne({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Reporte de zona no encontrado');

    report.status = status;
    report.resolutionNotes = notes ?? null;
    const saved = await this.zoneRepo.save(report);

    this.gateway.emitToMap('zone:updated', { id: saved.id, status: saved.status });
    return saved;
  }

  // --------------------------------------------------------------------------
  // Lectura
  // --------------------------------------------------------------------------

  private baseQuery() {
    return this.zoneRepo
      .createQueryBuilder('z')
      .addSelect(CONFIDENCE_SQL, 'confidence')
      .where('z."deletedAt" IS NULL');
  }

  /** Reportes de la ventana visible del mapa. */
  async query(query: QueryZonesDto): Promise<{ items: ZoneView[]; total: number }> {
    const qb = this.baseQuery().andWhere('z.status = :status', {
      status: ZoneReportStatus.ACTIVE,
    });

    if (query.bbox) {
      const box = parseBbox(query.bbox);
      // Se compara contra el punto y contra el tramo: un derrumbe cuyo punto de
      // referencia cae fuera de la pantalla puede tener el tramo cruzándola.
      qb.andWhere(
        `(ST_Intersects(z."location"::geometry, ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326))
          OR (z."path" IS NOT NULL AND ST_Intersects(z."path"::geometry, ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326))))`,
        box,
      );
    }

    if (query.types?.length) {
      qb.andWhere('z.type IN (:...types)', { types: query.types });
    }
    if (query.department) {
      qb.andWhere('z.department = :department', { department: query.department });
    }
    if (query.sinceRevision) {
      qb.andWhere('z.revision > :since', { since: query.sinceRevision });
    }

    const minConfidence = query.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    qb.andWhere(`${CONFIDENCE_SQL} >= :minConfidence`, { minConfidence });

    // Primero lo grave, luego lo confiable: en una emergencia el orden de
    // lectura del mapa importa tanto como su contenido.
    qb.orderBy('z.severity', 'DESC').addOrderBy('confidence', 'DESC').limit(query.limit ?? 500);

    const { entities, raw } = await qb.getRawAndEntities();
    return {
      total: entities.length,
      items: entities.map((entity, index) => toZoneView(entity, Number(raw[index]?.confidence ?? 0))),
    };
  }

  /** Qué hay alrededor de un punto: la consulta que hace la app al abrirse. */
  async nearby(query: NearbyZonesDto): Promise<{ items: ZoneView[] }> {
    const radius = query.radiusMeters ?? 5_000;

    const qb = this.baseQuery()
      .andWhere('z.status = :status', { status: ZoneReportStatus.ACTIVE })
      .andWhere(
        `ST_DWithin(z."location", ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radius)`,
        { lon: query.lon, lat: query.lat, radius },
      )
      .addSelect(
        `ST_Distance(z."location", ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography)`,
        'distance',
      )
      .andWhere(`${CONFIDENCE_SQL} >= :minConfidence`, { minConfidence: DEFAULT_MIN_CONFIDENCE })
      .orderBy('distance', 'ASC')
      .limit(query.limit ?? 100);

    const { entities, raw } = await qb.getRawAndEntities();
    return {
      items: entities.map((entity, index) =>
        toZoneView(entity, Number(raw[index]?.confidence ?? 0), Number(raw[index]?.distance ?? 0)),
      ),
    };
  }

  async findById(id: string): Promise<ZoneView> {
    const qb = this.baseQuery().andWhere('z.id = :id', { id });
    const { entities, raw } = await qb.getRawAndEntities();
    if (!entities.length) throw new NotFoundException('Reporte de zona no encontrado');
    return toZoneView(entities[0], Number(raw[0]?.confidence ?? 0));
  }

  /** Resumen por departamento para el tablero de situación. */
  async summaryByDepartment(): Promise<{ department: string; type: string; count: number }[]> {
    return this.zoneRepo
      .createQueryBuilder('z')
      .select('z.department', 'department')
      .addSelect('z.type', 'type')
      .addSelect('COUNT(*)::int', 'count')
      .where('z.status = :status', { status: ZoneReportStatus.ACTIVE })
      .andWhere('z."deletedAt" IS NULL')
      .andWhere('z.department IS NOT NULL')
      .groupBy('z.department')
      .addGroupBy('z.type')
      .orderBy('count', 'DESC')
      .getRawMany();
  }

  /** Catálogo de tipos, para que el cliente no lo tenga duplicado. */
  listTypes() {
    return Object.entries(ZONE_TYPE_CONFIG).map(([key, config]) => ({
      type: key as ZoneReportType,
      ...config,
    }));
  }

  // --------------------------------------------------------------------------
  // Mantenimiento
  // --------------------------------------------------------------------------

  /**
   * Retira del mapa lo que ya no es creíble.
   *
   * Un reporte con la confianza en el suelo deja de mostrarse por el filtro,
   * pero marcarlo como vencido saca sus filas del índice parcial y mantiene
   * pequeña la consulta que pinta el mapa, que es la más caliente del sistema.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async expireStaleReports(): Promise<void> {
    const result = await this.zoneRepo
      .createQueryBuilder()
      .update(ZoneReport)
      .set({ status: ZoneReportStatus.EXPIRED })
      .where('status = :active', { active: ZoneReportStatus.ACTIVE })
      .andWhere(
        `(("expiresAt" IS NOT NULL AND "expiresAt" < now()) OR ${confidenceSql('')} < 0.05)`,
      )
      .execute();

    if (result.affected) {
      this.logger.log(`${result.affected} reporte(s) de zona vencidos por antigüedad`);
      this.gateway.emitToMap('zone:expired', { count: result.affected });
    }
  }
}

export interface ZoneView {
  id: string;
  clientUuid: string;
  type: ZoneReportType;
  label: string;
  layer: string;
  location: { latitude: number; longitude: number };
  path: [number, number][] | null;
  radiusMeters: number | null;
  description: string | null;
  roadName: string | null;
  department: string | null;
  municipality: string | null;
  severity: number;
  confidence: number;
  confirmations: number;
  refutations: number;
  reportedAt: Date;
  lastConfirmedAt: Date;
  reporterRole: ReporterRole;
  reporterOrganization: string | null;
  status: ZoneReportStatus;
  revision: string;
  distanceMeters?: number;
}

function toZoneView(entity: ZoneReport, confidence: number, distanceMeters?: number): ZoneView {
  const config = ZONE_TYPE_CONFIG[entity.type];
  return {
    id: entity.id,
    clientUuid: entity.clientUuid,
    type: entity.type,
    label: config.label,
    layer: config.layer,
    location: {
      latitude: entity.location.coordinates[1],
      longitude: entity.location.coordinates[0],
    },
    path: entity.path?.coordinates ?? null,
    radiusMeters: entity.radiusMeters,
    description: entity.description,
    roadName: entity.roadName,
    department: entity.department,
    municipality: entity.municipality,
    severity: entity.severity,
    confidence: Number(confidence.toFixed(3)),
    confirmations: entity.confirmations,
    refutations: entity.refutations,
    reportedAt: entity.reportedAt,
    lastConfirmedAt: entity.lastConfirmedAt,
    reporterRole: entity.reporterRole,
    reporterOrganization: entity.reporterOrganization,
    status: entity.status,
    revision: entity.revision,
    ...(distanceMeters !== undefined ? { distanceMeters: Math.round(distanceMeters) } : {}),
  };
}
