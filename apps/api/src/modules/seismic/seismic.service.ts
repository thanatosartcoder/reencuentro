import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { haversineMeters, parseBbox, toGeoPoint, type GeoPoint } from 'src/common/geo/geo.util';
import { EVENT } from 'src/modules/situation/situation.data';
import { RealtimeGateway } from 'src/modules/notifications/realtime.gateway';
import { EventsService } from 'src/modules/events/events.service';
import { SeismicEvent } from './entities/seismic-event.entity';

/**
 * Catálogo de eventos sísmicos del USGS.
 *
 * Se replica en lugar de consultarse en vivo por tres razones: el mapa no puede
 * quedarse en blanco si el servicio externo no responde, los clientes offline
 * necesitan la copia local, y una réplica sentida a las 3 de la mañana tiene que
 * poder consultarse aunque el USGS esté saturado por ese mismo evento.
 *
 * Se usa el USGS y no el SGC porque el catálogo público del SGC llega hasta
 * 2020: su servicio ArcGIS `catalogo_sismos` es histórico, no un feed en vivo.
 * El USGS publica en minutos y su API está documentada y sin clave. Cuando el
 * SGC exponga un feed en tiempo real, entra como segunda fuente sobre el mismo
 * modelo: sus soluciones son más precisas dentro de Colombia por tener una red
 * de sismómetros más densa que la global.
 */

const USGS_ENDPOINT = 'https://earthquake.usgs.gov/fdsnws/event/1/query';

/** Radio alrededor del epicentro dentro del cual un sismo se cuenta como réplica. */
/**
 * Radio de respaldo cuando el evento no declara el suyo.
 *
 * 300 km cubre la zona de réplicas de un sismo somero de magnitud 7. Es un
 * valor razonable para empezar, no una verdad: cada emergencia debería declarar
 * el suyo en `events.searchRadiusKm`.
 */
const RADIO_POR_DEFECTO_KM = 300;

/** Magnitud mínima. Por debajo de 2.5 el ruido supera a la señal para uso público. */
const MIN_MAGNITUDE = 2.5;

interface UsgsFeature {
  id: string;
  properties: {
    time: number;
    updated: number;
    mag: number | null;
    magType: string | null;
    place: string | null;
    tsunami: number;
    cdi: number | null;
    url: string | null;
  };
  geometry: { coordinates: [number, number, number] };
}

@Injectable()
export class SeismicService {
  private readonly logger = new Logger(SeismicService.name);

  constructor(
    @InjectRepository(SeismicEvent)
    private readonly repo: Repository<SeismicEvent>,
    private readonly gateway: RealtimeGateway,
    private readonly events: EventsService,
  ) {}

  /**
   * Sincroniza con el USGS.
   *
   * Cada cinco minutos: el USGS revisa y corrige sus soluciones durante las
   * primeras horas tras un evento (la magnitud del sismo principal se ajustó
   * varias veces el 10 de agosto), así que no basta con traer lo nuevo, hay que
   * refrescar lo ya traído. Por eso la ventana se solapa hacia atrás.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sync(): Promise<{ fetched: number; created: number }> {
    const evento = await this.events.primary();

    // Sin epicentro no hay nada que buscar: una inundación o un deslizamiento
    // no tienen réplicas. Se sale en silencio en vez de fallar — que la
    // emergencia en curso no sea sísmica es normal, no un error.
    if (!evento?.epicentro) {
      return { fetched: 0, created: 0 };
    }

    const epicentro = toGeoPoint(evento.epicentro.latitud, evento.epicentro.longitud);
    const ocurrioEl = new Date(evento.ocurrioEl);

    const params = new URLSearchParams({
      format: 'geojson',
      starttime: ocurrioEl.toISOString(),
      latitude: String(evento.epicentro.latitud),
      longitude: String(evento.epicentro.longitud),
      maxradiuskm: String(evento.radioKm ?? RADIO_POR_DEFECTO_KM),
      minmagnitude: String(MIN_MAGNITUDE),
      orderby: 'time',
    });

    let features: UsgsFeature[];
    try {
      const response = await fetch(`${USGS_ENDPOINT}?${params}`, {
        headers: { Accept: 'application/geo+json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new Error(`USGS respondió ${response.status}`);
      }
      const body = (await response.json()) as { features: UsgsFeature[] };
      features = body.features ?? [];
    } catch (error) {
      // Un fallo aquí no rompe nada: el mapa sigue mostrando la copia local.
      this.logger.warn(
        `No se pudo sincronizar con el USGS: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { fetched: 0, created: 0 };
    }

    let created = 0;

    for (const feature of features) {
      if (feature.properties.mag === null) continue;

      const [longitude, latitude, depthKm] = feature.geometry.coordinates;
      const location = toGeoPoint(latitude, longitude);
      const occurredAt = new Date(feature.properties.time);

      const distanceKm = haversineMeters(epicentro, location) / 1000;

      // El evento principal es el más antiguo de la secuencia y el de mayor
      // magnitud; se marca por su hora de origen, que es el dato firme.
      const isMainshock =
        Math.abs(occurredAt.getTime() - ocurrioEl.getTime()) < 120_000 &&
        feature.properties.mag >= 7;

      const existing = await this.repo.findOne({
        where: { source: 'USGS', externalId: feature.id },
      });

      const values = {
        source: 'USGS',
        externalId: feature.id,
        occurredAt,
        magnitude: feature.properties.mag,
        magnitudeType: feature.properties.magType,
        depthKm,
        location,
        place: feature.properties.place,
        distanceToMainshockKm: Number(distanceKm.toFixed(2)),
        isMainshock,
        tsunamiWarning: feature.properties.tsunami === 1,
        communityIntensity: feature.properties.cdi,
        detailUrl: feature.properties.url,
      };

      if (existing) {
        // Se actualiza en vez de ignorar: el USGS corrige magnitud y
        // profundidad durante las horas siguientes a cada evento.
        await this.repo.update(existing.id, values);
      } else {
        await this.repo.save(this.repo.create({ ...values, eventId: evento.id }));
        created++;

        // Una réplica fuerte cambia lo que la gente necesita saber ahora mismo.
        if (feature.properties.mag >= 5) {
          this.gateway.emitToMap('seismic:aftershock', {
            magnitude: feature.properties.mag,
            depthKm,
            place: feature.properties.place,
            occurredAt,
            latitude,
            longitude,
          });
        }
      }
    }

    if (created > 0) {
      this.logger.log(`${created} evento(s) sísmico(s) nuevo(s) desde el USGS`);
    }
    return { fetched: features.length, created };
  }

  /** Réplicas para pintar en el mapa. */
  async list(options: {
    bbox?: string;
    minMagnitude?: number;
    sinceHours?: number;
    limit?: number;
    /** Emergencia a consultar. Sin ella, la que esté en curso. */
    evento?: string;
  }): Promise<SeismicView[]> {
    // Las réplicas pertenecen a su sismo: listarlas junto a las de otro daría
    // una secuencia que nunca ocurrió.
    const qb = this.repo
      .createQueryBuilder('e')
      .where('e."eventId" = :eventId', { eventId: await this.events.idFor(options.evento) });

    if (options.minMagnitude !== undefined) {
      qb.andWhere('e.magnitude >= :minMag', { minMag: options.minMagnitude });
    }
    if (options.sinceHours !== undefined) {
      qb.andWhere(`e."occurredAt" >= now() - (:hours || ' hours')::interval`, {
        hours: options.sinceHours,
      });
    }
    if (options.bbox) {
      const box = parseBbox(options.bbox);
      qb.andWhere(
        `ST_Intersects(e."location"::geometry, ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326))`,
        box,
      );
    }

    const rows = await qb
      .orderBy('e."occurredAt"', 'DESC')
      .limit(options.limit ?? 500)
      .getMany();

    return rows.map(toSeismicView);
  }

  /** Resumen de la secuencia sísmica para el tablero de situación. */
  async summary(): Promise<{
    total: number;
    mainshock: SeismicView | null;
    strongest: SeismicView | null;
    latest: SeismicView | null;
    byMagnitude: { rango: string; conteo: number }[];
    lastSyncedAt: string | null;
  }> {
    const [total, mainshock, strongest, latest] = await Promise.all([
      this.repo.count(),
      this.repo.findOne({ where: { isMainshock: true } }),
      this.repo.findOne({ where: {}, order: { magnitude: 'DESC' } }),
      this.repo.findOne({ where: {}, order: { occurredAt: 'DESC' } }),
    ]);

    // Las réplicas se agrupan por magnitud entera, que es como se comunican en
    // los boletines y como la gente las entiende.
    const buckets = await this.repo
      .createQueryBuilder('e')
      .select(`floor(e.magnitude)::int`, 'floor')
      .addSelect('COUNT(*)::int', 'conteo')
      .where('e."isMainshock" = false')
      .groupBy('floor')
      .orderBy('floor', 'DESC')
      .getRawMany<{ floor: number; conteo: number }>();

    const lastUpdated = await this.repo.findOne({ where: {}, order: { updatedAt: 'DESC' } });

    return {
      total,
      mainshock: mainshock ? toSeismicView(mainshock) : null,
      strongest: strongest ? toSeismicView(strongest) : null,
      latest: latest ? toSeismicView(latest) : null,
      byMagnitude: buckets.map((b) => ({
        rango: `M ${b.floor}.0 – ${b.floor}.9`,
        conteo: b.conteo,
      })),
      lastSyncedAt: lastUpdated?.updatedAt.toISOString() ?? null,
    };
  }
}

export interface SeismicView {
  id: string;
  source: string;
  externalId: string;
  occurredAt: Date;
  magnitude: number;
  magnitudeType: string | null;
  depthKm: number | null;
  latitude: number;
  longitude: number;
  place: string | null;
  distanceToMainshockKm: number | null;
  isMainshock: boolean;
  communityIntensity: number | null;
  detailUrl: string | null;
}

function toSeismicView(event: SeismicEvent): SeismicView {
  return {
    id: event.id,
    source: event.source,
    externalId: event.externalId,
    occurredAt: event.occurredAt,
    magnitude: event.magnitude,
    magnitudeType: event.magnitudeType,
    depthKm: event.depthKm,
    latitude: event.location.coordinates[1],
    longitude: event.location.coordinates[0],
    place: event.place,
    distanceToMainshockKm: event.distanceToMainshockKm,
    isMainshock: event.isMainshock,
    communityIntensity: event.communityIntensity,
    detailUrl: event.detailUrl,
  };
}
