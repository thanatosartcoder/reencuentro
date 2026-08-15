import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventsService } from 'src/modules/events/events.service';
import { haversineMeters, toGeoPoint } from 'src/common/geo/geo.util';
import { ZONE_TYPE_CONFIG, ZoneReportType } from 'src/modules/geo/geo.enums';
import { AFFECTED_CAPITALS, EPICENTER_TOWN } from 'src/modules/situation/situation.data';

/**
 * Agregación territorial.
 *
 * El mapa mostraba pines sueltos: un reporte de vía por aquí, una edificación
 * dañada por allá. Eso responde "qué hay en este punto exacto" pero no responde
 * la pregunta con la que la gente llega al mapa, que es "cómo está este
 * municipio". Quien coordina una respuesta necesita saber que en Quibdó hay
 * doce desaparecidos sin localizar y tres vías cortadas, no tener que contar
 * pines a ojo.
 *
 * Las personas desaparecidas se agregan y nunca se dibujan como puntos
 * individuales. Un pin por persona expondría la última ubicación conocida de
 * cada una —incluidos menores— en un mapa público, y el listado ya publica el
 * municipio: agregar no oculta nada que estuviera disponible, pero evita
 * convertir el mapa en un rastreador de individuos.
 */

/** Radio para atribuir una réplica al municipio más cercano. */
const AFTERSHOCK_ATTRIBUTION_RADIUS_KM = 60;

interface MunicipalityRow {
  municipality: string;
  department: string | null;
  lat: number | null;
  lon: number | null;
}

export interface MunicipalityAggregate {
  municipality: string;
  department: string | null;
  /** Punto representativo: centroide de los reportes o, si no hay, la capital conocida. */
  point: { latitude: number; longitude: number } | null;
  /** true si el punto viene de una coordenada conocida y no de los datos. */
  pointIsApproximate: boolean;
  desaparecidos: {
    activos: number;
    localizadosConVida: number;
    localizadosSinVida: number;
    menores: number;
    total: number;
  };
  avistamientos: { abiertos: number };
  zonas: {
    total: number;
    porCapa: Record<string, number>;
    severidadMaxima: number;
    viasBloqueadas: number;
  };
  danos: {
    edificaciones: number;
    /**
     * Si existe evaluación publicada para este municipio. Sin esta bandera,
     * "0 edificaciones" es ambiguo entre "se miró y está bien" y "nadie ha
     * mirado", que es la diferencia entre tranquilizar y desinformar.
     */
    evaluado: boolean;
  };
  replicas: { conteo: number; magnitudMaxima: number | null };
  /**
   * Puntaje de atención 0..100. Ordena la lista; no pretende medir gravedad
   * real, solo cuánta actividad sin resolver concentra el municipio.
   */
  prioridad: number;
}

@Injectable()
export class OverviewService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly events: EventsService,
  ) {}

  async byMunicipality(): Promise<{
    items: MunicipalityAggregate[];
    totales: {
      municipios: number;
      desaparecidosActivos: number;
      edificacionesDanadas: number;
      viasBloqueadas: number;
    };
  }> {
    // Cada fuente se consulta por separado y se fusiona en memoria. La
    // alternativa —un solo SQL con cinco FULL OUTER JOIN sobre agregados— es
    // más difícil de leer y de corregir, y aquí la cardinalidad es de decenas
    // de municipios, no de millones de filas.
    // Las capas de contexto se acotan a la emergencia en curso: sumar
    // derrumbes de dos catástrofes distintas daría un mapa que no describe
    // ninguna. Los desaparecidos y los avistamientos NO se acotan, a propósito:
    // una persona puede haber sido reportada durante otra emergencia.
    const eventId = await this.events.primaryId();

    const [missing, sightings, zones, damage, aftershocks] = await Promise.all([
      this.missingByMunicipality(),
      this.sightingsByMunicipality(),
      this.zonesByMunicipality(eventId),
      this.damageByCity(eventId),
      this.aftershockPoints(eventId),
    ]);

    const merged = new Map<string, MunicipalityAggregate>();

    const keyOf = (municipality: string, department: string | null) =>
      `${municipality.trim().toLowerCase()}|${(department ?? '').trim().toLowerCase()}`;

    const ensure = (row: MunicipalityRow): MunicipalityAggregate => {
      const key = keyOf(row.municipality, row.department);
      let entry = merged.get(key);
      if (!entry) {
        entry = {
          municipality: row.municipality,
          department: row.department,
          point: null,
          pointIsApproximate: false,
          desaparecidos: {
            activos: 0,
            localizadosConVida: 0,
            localizadosSinVida: 0,
            menores: 0,
            total: 0,
          },
          avistamientos: { abiertos: 0 },
          zonas: { total: 0, porCapa: {}, severidadMaxima: 0, viasBloqueadas: 0 },
          danos: { edificaciones: 0, evaluado: false },
          replicas: { conteo: 0, magnitudMaxima: null },
          prioridad: 0,
        };
        merged.set(key, entry);
      }
      // El primer punto real que aparezca se queda: da igual de qué fuente
      // venga, cualquiera es mejor que la coordenada aproximada de respaldo.
      if (!entry.point && row.lat !== null && row.lon !== null) {
        entry.point = { latitude: row.lat, longitude: row.lon };
      }
      return entry;
    };

    for (const row of missing) {
      const entry = ensure(row);
      entry.desaparecidos = {
        activos: row.activos,
        localizadosConVida: row.con_vida,
        localizadosSinVida: row.sin_vida,
        menores: row.menores,
        total: row.total,
      };
    }

    for (const row of sightings) {
      ensure(row).avistamientos.abiertos = row.abiertos;
    }

    for (const row of zones) {
      const entry = ensure(row);
      const layer = ZONE_TYPE_CONFIG[row.type as ZoneReportType]?.layer ?? 'SERVICE';

      entry.zonas.total += row.conteo;
      entry.zonas.porCapa[layer] = (entry.zonas.porCapa[layer] ?? 0) + row.conteo;
      entry.zonas.severidadMaxima = Math.max(entry.zonas.severidadMaxima, row.severidad_max);

      // Las vías cortadas se cuentan aparte: es el dato que decide si una
      // ambulancia puede llegar, y se pierde dentro del total de "zonas".
      if (
        row.type === ZoneReportType.ROAD_BLOCKED ||
        row.type === ZoneReportType.BRIDGE_DOWN ||
        row.type === ZoneReportType.LANDSLIDE
      ) {
        entry.zonas.viasBloqueadas += row.conteo;
      }
    }

    for (const row of damage) {
      ensure(row).danos.edificaciones = row.edificaciones;
    }

    // Un municipio cuenta como evaluado si su punto cae dentro de un área con
    // evaluación publicada. Se comprueba por geometría y no por nombre para
    // que un dataset futuro que cubra varios municipios a la vez funcione sin
    // tocar este código.
    const coverage = await this.dataSource.query<{ city: string; area: string }[]>(
      `SELECT city, ST_AsText(area::geometry) AS area FROM damage_coverage
         WHERE "eventId" = $1`,
      [eventId],
    );

    if (coverage.length) {
      for (const entry of merged.values()) {
        if (!entry.point) continue;
        const [inside] = await this.dataSource.query<{ hit: boolean }[]>(
          `SELECT EXISTS (
             SELECT 1 FROM damage_coverage
             WHERE "eventId" = $3
               AND ST_Intersects(area::geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
           ) AS hit`,
          [entry.point.longitude, entry.point.latitude, eventId],
        );
        entry.danos.evaluado = Boolean(inside?.hit) || entry.danos.edificaciones > 0;
      }
    }

    // --- Puntos de respaldo y atribución de réplicas ---
    const knownPoints = new Map<string, { latitude: number; longitude: number }>();
    for (const capital of AFFECTED_CAPITALS) {
      knownPoints.set(capital.name.toLowerCase(), {
        latitude: capital.latitude,
        longitude: capital.longitude,
      });
    }
    knownPoints.set(EPICENTER_TOWN.name.toLowerCase(), {
      latitude: EPICENTER_TOWN.latitude,
      longitude: EPICENTER_TOWN.longitude,
    });

    for (const entry of merged.values()) {
      if (!entry.point) {
        const known = knownPoints.get(entry.municipality.trim().toLowerCase());
        if (known) {
          // Un municipio cuyos reportes no traen coordenada —frecuente cuando
          // se reporta sin señal y el GPS no fija— se ubica en su cabecera
          // conocida y se marca como aproximado, para no fingir precisión.
          entry.point = known;
          entry.pointIsApproximate = true;
        }
      }

      if (entry.point) {
        const municipality = toGeoPoint(entry.point.latitude, entry.point.longitude);
        // Son pocas réplicas; atribuirlas en memoria evita una consulta
        // espacial por municipio.
        for (const quake of aftershocks) {
          const distanceKm =
            haversineMeters(municipality, toGeoPoint(quake.lat, quake.lon)) / 1000;
          if (distanceKm <= AFTERSHOCK_ATTRIBUTION_RADIUS_KM) {
            entry.replicas.conteo++;
            entry.replicas.magnitudMaxima = Math.max(
              entry.replicas.magnitudMaxima ?? 0,
              quake.magnitude,
            );
          }
        }
      }

      entry.prioridad = priorityScore(entry);
    }

    const items = [...merged.values()].sort((a, b) => b.prioridad - a.prioridad);

    return {
      items,
      totales: {
        municipios: items.length,
        desaparecidosActivos: items.reduce((sum, i) => sum + i.desaparecidos.activos, 0),
        edificacionesDanadas: items.reduce((sum, i) => sum + i.danos.edificaciones, 0),
        viasBloqueadas: items.reduce((sum, i) => sum + i.zonas.viasBloqueadas, 0),
      },
    };
  }

  /**
   * Qué hay alrededor de un punto.
   *
   * Responde la pregunta que se hace quien mira un reporte concreto: "vale,
   * hay un derrumbe aquí, ¿y qué más hay cerca?". Sin esto cada pin es un
   * dato aislado y el mapa no ayuda a decidir nada.
   */
  async contextAround(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<{
    radioMetros: number;
    desaparecidos: { activos: number; menores: number };
    avistamientos: number;
    zonas: { activas: number; viasBloqueadas: number; recursos: number };
    danos: number;
    replicas: { conteo: number; magnitudMaxima: number | null };
  }> {
    // Dos arreglos, no uno: Postgres rechaza una consulta a la que le sobran
    // parámetros. Las personas se cuentan SIN acotar por evento —un desaparecido
    // de otra emergencia sigue siendo alguien que puede estar cerca de aquí— y
    // las capas de contexto sí se acotan, porque sumar derrumbes de dos
    // catástrofes describiría un lugar que no existe.
    const params = [longitude, latitude, radiusMeters];
    const paramsConEvento = [...params, await this.events.primaryId()];
    const point = `ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography`;

    const [missing, sightings, zoneRows, damage, quakes] = await Promise.all([
      this.dataSource.query<{ activos: string; menores: string }[]>(
        `SELECT COUNT(*) FILTER (WHERE status = 'ACTIVE') AS activos,
                COUNT(*) FILTER (WHERE status = 'ACTIVE' AND "isMinor") AS menores
         FROM missing_person_reports
         WHERE "deletedAt" IS NULL
           AND "lastSeenLocation" IS NOT NULL
           AND ST_DWithin("lastSeenLocation", ${point}, $3)`,
        params,
      ),
      this.dataSource.query<{ total: string }[]>(
        `SELECT COUNT(*) AS total FROM sighting_reports
         WHERE "deletedAt" IS NULL AND status = 'OPEN'
           AND "location" IS NOT NULL
           AND ST_DWithin("location", ${point}, $3)`,
        params,
      ),
      this.dataSource.query<{ type: string; conteo: string }[]>(
        `SELECT type, COUNT(*) AS conteo FROM zone_reports
         WHERE "deletedAt" IS NULL AND status = 'ACTIVE'
           AND "eventId" = $4
           AND ST_DWithin("location", ${point}, $3)
         GROUP BY type`,
        paramsConEvento,
      ),
      this.dataSource.query<{ total: string }[]>(
        `SELECT COUNT(*) AS total FROM damage_assessments
         WHERE damaged = true AND "eventId" = $4
           AND ST_DWithin(footprint, ${point}, $3)`,
        paramsConEvento,
      ),
      this.dataSource.query<{ conteo: string; max_mag: number | null }[]>(
        `SELECT COUNT(*) AS conteo, MAX(magnitude) AS max_mag FROM seismic_events
         WHERE "eventId" = $4 AND ST_DWithin("location", ${point}, $3)`,
        paramsConEvento,
      ),
    ]);

    let viasBloqueadas = 0;
    let recursos = 0;
    let activas = 0;

    for (const row of zoneRows) {
      const conteo = Number(row.conteo);
      activas += conteo;
      const config = ZONE_TYPE_CONFIG[row.type as ZoneReportType];
      if (config?.layer === 'RESOURCE') recursos += conteo;
      if (
        row.type === ZoneReportType.ROAD_BLOCKED ||
        row.type === ZoneReportType.BRIDGE_DOWN ||
        row.type === ZoneReportType.LANDSLIDE
      ) {
        viasBloqueadas += conteo;
      }
    }

    return {
      radioMetros: radiusMeters,
      desaparecidos: {
        activos: Number(missing[0]?.activos ?? 0),
        menores: Number(missing[0]?.menores ?? 0),
      },
      avistamientos: Number(sightings[0]?.total ?? 0),
      zonas: { activas, viasBloqueadas, recursos },
      danos: Number(damage[0]?.total ?? 0),
      replicas: {
        conteo: Number(quakes[0]?.conteo ?? 0),
        magnitudMaxima: quakes[0]?.max_mag ?? null,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Consultas por fuente
  // --------------------------------------------------------------------------

  private missingByMunicipality() {
    // ST_Collect descarta las geometrías nulas, así que el centroide sale de
    // los reportes que sí traen coordenada y devuelve NULL si ninguno la trae.
    return this.dataSource.query<
      (MunicipalityRow & {
        activos: number;
        con_vida: number;
        sin_vida: number;
        menores: number;
        total: number;
      })[]
    >(`
      SELECT municipality, department,
             COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS activos,
             COUNT(*) FILTER (WHERE status = 'FOUND_ALIVE')::int AS con_vida,
             COUNT(*) FILTER (WHERE status = 'FOUND_DECEASED')::int AS sin_vida,
             COUNT(*) FILTER (WHERE "isMinor")::int AS menores,
             COUNT(*)::int AS total,
             ST_Y(ST_Centroid(ST_Collect("lastSeenLocation"::geometry))) AS lat,
             ST_X(ST_Centroid(ST_Collect("lastSeenLocation"::geometry))) AS lon
      FROM missing_person_reports
      WHERE "deletedAt" IS NULL AND municipality IS NOT NULL
      GROUP BY municipality, department
    `);
  }

  private sightingsByMunicipality() {
    return this.dataSource.query<(MunicipalityRow & { abiertos: number })[]>(`
      SELECT municipality, department,
             COUNT(*) FILTER (WHERE status = 'OPEN')::int AS abiertos,
             ST_Y(ST_Centroid(ST_Collect("location"::geometry))) AS lat,
             ST_X(ST_Centroid(ST_Collect("location"::geometry))) AS lon
      FROM sighting_reports
      WHERE "deletedAt" IS NULL AND municipality IS NOT NULL
      GROUP BY municipality, department
    `);
  }

  private zonesByMunicipality(eventId: string) {
    return this.dataSource.query<
      (MunicipalityRow & { type: string; conteo: number; severidad_max: number })[]
    >(`
      SELECT municipality, department, type,
             COUNT(*)::int AS conteo,
             MAX(severity)::int AS severidad_max,
             ST_Y(ST_Centroid(ST_Collect("location"::geometry))) AS lat,
             ST_X(ST_Centroid(ST_Collect("location"::geometry))) AS lon
      FROM zone_reports
      WHERE "deletedAt" IS NULL AND status = 'ACTIVE' AND municipality IS NOT NULL
        AND "eventId" = $1
      GROUP BY municipality, department, type
    `, [eventId]);
  }

  private damageByCity(eventId: string) {
    return this.dataSource.query<(MunicipalityRow & { edificaciones: number })[]>(`
      SELECT city AS municipality, department,
             COUNT(*)::int AS edificaciones,
             ST_Y(ST_Centroid(ST_Collect(footprint::geometry))) AS lat,
             ST_X(ST_Centroid(ST_Collect(footprint::geometry))) AS lon
      FROM damage_assessments
      WHERE damaged = true AND "eventId" = $1
      GROUP BY city, department
    `, [eventId]);
  }

  private aftershockPoints(eventId: string) {
    return this.dataSource.query<{ lat: number; lon: number; magnitude: number }[]>(`
      SELECT ST_Y("location"::geometry) AS lat,
             ST_X("location"::geometry) AS lon,
             magnitude
      FROM seismic_events
      WHERE "eventId" = $1
    `, [eventId]);
  }
}

/**
 * Puntaje de atención.
 *
 * Ordena la lista de municipios; no mide gravedad real. Las personas sin
 * localizar dominan el puntaje a propósito —son el objeto del sistema— y los
 * menores pesan doble. Las vías cortadas van después porque condicionan si se
 * puede llegar. El daño en edificaciones aporta poco: son cientos de registros
 * y sin ponderarlos a la baja aplastarían todo lo demás.
 */
function priorityScore(entry: MunicipalityAggregate): number {
  const raw =
    entry.desaparecidos.activos * 10 +
    entry.desaparecidos.menores * 10 +
    entry.zonas.viasBloqueadas * 6 +
    entry.zonas.severidadMaxima * 3 +
    entry.avistamientos.abiertos * 2 +
    entry.danos.edificaciones * 0.05 +
    (entry.replicas.magnitudMaxima ?? 0);

  return Math.min(100, Math.round(raw));
}
