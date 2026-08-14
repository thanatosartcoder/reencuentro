import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parseBbox } from 'src/common/geo/geo.util';
import { RoadSegment } from './entities/road-segment.entity';

/**
 * Consulta de la red vial.
 *
 * La atribución de OpenStreetMap viaja con cada respuesta, no solo en el pie de
 * la página web: la licencia ODbL obliga a quien reutilice estos datos, y un
 * consumidor de la API nunca ve el pie de página.
 */
export const OSM_ATTRIBUTION =
  'Datos viales © colaboradores de OpenStreetMap, licencia ODbL. ' +
  'Export de Humanitarian OpenStreetMap Team del 13 de agosto de 2026.';

/**
 * Clases que se muestran a cada nivel de zoom.
 *
 * Dibujar 160.000 tramos cuando se ve el país entero satura la red y no aporta
 * nada legible: a esa escala solo importan las troncales. El detalle aparece al
 * acercarse, que es cuando se puede distinguir.
 */
const ZOOM_TIERS: { maxSpanDegrees: number; highways: string[] }[] = [
  {
    maxSpanDegrees: 0.15,
    highways: [], // sin filtro: todo
  },
  {
    maxSpanDegrees: 0.6,
    highways: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'track'],
  },
  {
    maxSpanDegrees: 2,
    highways: ['motorway', 'trunk', 'primary', 'secondary'],
  },
  {
    maxSpanDegrees: Infinity,
    highways: ['motorway', 'trunk', 'primary'],
  },
];

@Injectable()
export class RoadsService {
  constructor(
    @InjectRepository(RoadSegment)
    private readonly repo: Repository<RoadSegment>,
  ) {}

  /** Tramos dentro de la ventana visible, con el detalle acorde a la escala. */
  async query(options: {
    bbox?: string;
    highways?: string[];
    namedOnly?: boolean;
    limit?: number;
  }): Promise<RoadView[]> {
    const qb = this.repo.createQueryBuilder('r');

    if (options.bbox) {
      const box = parseBbox(options.bbox);
      qb.andWhere(
        `ST_Intersects(r."path"::geometry, ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326))`,
        box,
      );

      // El nivel de detalle se deduce del tamaño de la ventana en lugar de
      // pedirle el zoom al cliente: así cualquier consumidor de la API obtiene
      // una respuesta proporcionada sin tener que saber esta regla.
      if (!options.highways?.length) {
        const span = Math.max(box.maxLon - box.minLon, box.maxLat - box.minLat);
        const tier = ZOOM_TIERS.find((t) => span <= t.maxSpanDegrees);
        if (tier?.highways.length) {
          qb.andWhere('r.highway IN (:...tierHighways)', { tierHighways: tier.highways });
        }
      }
    }

    if (options.highways?.length) {
      qb.andWhere('r.highway IN (:...highways)', { highways: options.highways });
    }
    if (options.namedOnly) {
      qb.andWhere('r.name IS NOT NULL');
    }

    const rows = await qb
      .orderBy('r."lengthMeters"', 'DESC', 'NULLS LAST')
      .limit(options.limit ?? 3000)
      .getMany();

    return rows.map(toRoadView);
  }

  /**
   * Vías con nombre cerca de un punto, ordenadas por cercanía.
   *
   * Alimenta el autocompletado del formulario de reporte. Que la gente elija el
   * nombre de una lista real en vez de escribirlo hace que dos reportes sobre
   * la misma carretera se puedan agrupar: "vía Quibdó–Pereira", "via a pereira"
   * y "carretera quibdo pereira" son hoy tres cosas distintas para el sistema.
   */
  async nearby(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<NearbyRoad[]> {
    const rows = await this.repo.query<
      {
        name: string;
        highway: string;
        surface: string | null;
        distancia: number;
        tramos: number;
      }[]
    >(
      `SELECT name,
              (array_agg(highway ORDER BY "lengthMeters" DESC))[1] AS highway,
              (array_agg(surface ORDER BY "lengthMeters" DESC))[1] AS surface,
              MIN(ST_Distance(path, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)) AS distancia,
              COUNT(*)::int AS tramos
       FROM road_segments
       WHERE name IS NOT NULL
         AND ST_DWithin(path, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
       GROUP BY name
       ORDER BY distancia ASC
       LIMIT 15`,
      [longitude, latitude, radiusMeters],
    );

    return rows.map((row) => ({
      name: row.name,
      highway: row.highway,
      surface: row.surface,
      distanceMeters: Math.round(row.distancia),
      segments: row.tramos,
    }));
  }

  /**
   * Inventario vial de un área.
   *
   * Da la escala del problema: saber que un municipio tiene 40 km de red y que
   * dos tramos están cortados dice mucho más que el número de reportes suelto.
   */
  async summary(bbox?: string): Promise<{
    totalKm: number;
    porClase: { clase: string; km: number; tramos: number }[];
    sinPavimentar: { km: number; porcentaje: number };
    puentes: number;
    atribucion: string;
  }> {
    const params: unknown[] = [];
    let where = '1=1';

    if (bbox) {
      const box = parseBbox(bbox);
      where = `ST_Intersects(path::geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))`;
      params.push(box.minLon, box.minLat, box.maxLon, box.maxLat);
    }

    const rows = await this.repo.query<{ clase: string; km: string; tramos: number }[]>(
      `SELECT highway AS clase,
              round((SUM("lengthMeters") / 1000)::numeric, 1) AS km,
              COUNT(*)::int AS tramos
       FROM road_segments WHERE ${where}
       GROUP BY highway ORDER BY SUM("lengthMeters") DESC`,
      params,
    );

    const [extra] = await this.repo.query<
      { sin_pavimentar: string | null; total: string | null; puentes: number }[]
    >(
      `SELECT round((SUM("lengthMeters") FILTER (
                WHERE surface IN ('unpaved','dirt','ground','gravel','earth','sand','mud','grass')
              ) / 1000)::numeric, 1) AS sin_pavimentar,
              round((SUM("lengthMeters") / 1000)::numeric, 1) AS total,
              COUNT(*) FILTER (WHERE "isBridge")::int AS puentes
       FROM road_segments WHERE ${where}`,
      params,
    );

    const totalKm = Number(extra?.total ?? 0);
    const unpavedKm = Number(extra?.sin_pavimentar ?? 0);

    return {
      totalKm,
      porClase: rows.map((r) => ({ clase: r.clase, km: Number(r.km), tramos: r.tramos })),
      // La superficie condiciona qué vehículo puede pasar, sobre todo en
      // temporada de lluvias sobre vía destapada.
      sinPavimentar: {
        km: unpavedKm,
        porcentaje: totalKm > 0 ? Number(((unpavedKm / totalKm) * 100).toFixed(1)) : 0,
      },
      puentes: extra?.puentes ?? 0,
      atribucion: OSM_ATTRIBUTION,
    };
  }

  /** Búsqueda por nombre, para encontrar un corredor concreto. */
  async searchByName(query: string, limit = 20): Promise<NearbyRoad[]> {
    const rows = await this.repo.query<
      { name: string; highway: string; surface: string | null; km: string; tramos: number }[]
    >(
      `SELECT name,
              (array_agg(highway ORDER BY "lengthMeters" DESC))[1] AS highway,
              (array_agg(surface ORDER BY "lengthMeters" DESC))[1] AS surface,
              round((SUM("lengthMeters") / 1000)::numeric, 1) AS km,
              COUNT(*)::int AS tramos
       FROM road_segments
       WHERE name IS NOT NULL
         AND word_similarity(lower(immutable_unaccent($1)), lower(immutable_unaccent(name))) > 0.45
       GROUP BY name
       ORDER BY SUM("lengthMeters") DESC
       LIMIT $2`,
      [query, limit],
    );

    return rows.map((row) => ({
      name: row.name,
      highway: row.highway,
      surface: row.surface,
      distanceMeters: null,
      lengthKm: Number(row.km),
      segments: row.tramos,
    }));
  }
}

export interface RoadView {
  id: string;
  osmId: string;
  highway: string;
  name: string | null;
  surface: string | null;
  isBridge: boolean;
  isTunnel: boolean;
  lengthMeters: number | null;
  path: RoadSegment['path'];
}

export interface NearbyRoad {
  name: string;
  highway: string;
  surface: string | null;
  distanceMeters: number | null;
  lengthKm?: number;
  segments: number;
}

function toRoadView(segment: RoadSegment): RoadView {
  return {
    id: segment.id,
    osmId: segment.osmId,
    highway: segment.highway,
    name: segment.name,
    surface: segment.surface,
    isBridge: segment.isBridge,
    isTunnel: segment.isTunnel,
    lengthMeters: segment.lengthMeters,
    path: segment.path,
  };
}
