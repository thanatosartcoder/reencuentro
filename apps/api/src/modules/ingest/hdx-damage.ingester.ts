import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import type { DataSource, EntityManager } from 'typeorm';
import { consoleLogger, downloadCached, fetchHdxVersion, type IngestLogger } from './hdx-client';

/**
 * Ingesta de las evaluaciones de daño publicadas en HDX por el Microsoft AI for
 * Good Lab.
 *
 * Los datos vienen en GeoPackage, que es SQLite por dentro. En vez de exigir
 * GDAL instalado se lee el archivo directamente y se le entrega a PostGIS el
 * WKB tal cual: la reproyección de UTM 18N a WGS 84 la hace `ST_Transform`, que
 * es más confiable que reimplementarla en JavaScript.
 *
 * Solo se guardan las edificaciones marcadas como dañadas. De las 35.760
 * evaluadas en Pereira, 309 lo están; almacenar las 35.451 restantes cargaría
 * la base con la afirmación menos accionable del conjunto ("esta casa parece
 * estar bien según una foto satelital").
 *
 * Junto a cada dataset se carga su `valid_area_mask`: el polígono de hasta
 * dónde miró el modelo. Sin él, el mapa hace indistinguibles "aquí se miró y no
 * hay daño" y "aquí nadie ha mirado", que en esta emergencia apuntan en
 * direcciones opuestas.
 */

export interface HdxDamageDataset {
  datasetId: string;
  city: string;
  department: string;
  publisher: string;
  imagerySource: string;
  footprintSource: string;
  imageryDate: string;
  url: string;
  fileName: string;
  maskUrl: string;
  maskFileName: string;
  buildingsAssessed: number;
}

export const DAMAGE_DATASETS: HdxDamageDataset[] = [
  {
    datasetId: '2026-colombia-earthquake',
    city: 'Cali',
    department: 'Valle del Cauca',
    publisher: 'Microsoft AI for Good Lab',
    imagerySource: 'Airbus',
    footprintSource: 'Overture',
    imageryDate: '2026-08-10',
    url: 'https://data.humdata.org/dataset/98e2bb4b-e2b9-4178-bf47-826883ca08cc/resource/a00eebfb-0590-456a-b46d-4633122330d9/download/airbus_8-10_cali_overture_building_footprints_with_predictions.gpkg',
    fileName: 'cali_overture.gpkg',
    maskUrl:
      'https://data.humdata.org/dataset/98e2bb4b-e2b9-4178-bf47-826883ca08cc/resource/2e917265-3d4e-4660-8256-51c77c435063/download/airbus_8-10_cali_valid_area_mask.geojson',
    maskFileName: 'cali_mask.geojson',
    buildingsAssessed: 97_085,
  },
  {
    datasetId: 'colombia-2026-earthquake-pereira',
    city: 'Pereira',
    department: 'Risaralda',
    publisher: 'Microsoft AI for Good Lab',
    imagerySource: 'Vantor',
    footprintSource: 'Overture',
    imageryDate: '2026-08-12',
    url: 'https://data.humdata.org/dataset/ee1f2b95-25ce-4927-91f1-0b432f032091/resource/ecb4cdf6-4f5c-41d8-80e4-1cb2be346e00/download/vantor_8-12_pereira_overture_buildings_with_predictions.gpkg',
    fileName: 'pereira_overture.gpkg',
    maskUrl:
      'https://data.humdata.org/dataset/ee1f2b95-25ce-4927-91f1-0b432f032091/resource/bb51b3cd-7f0a-4d25-bb7a-bb1d82d8b4ac/download/vantor_8-12_pereira_valid_area_mask.geojson',
    maskFileName: 'pereira_mask.geojson',
    buildingsAssessed: 35_760,
  },
];

const BATCH_SIZE = 200;

/**
 * Extrae el WKB de un blob de geometría de GeoPackage.
 *
 * El formato antepone una cabecera propia al WKB estándar: dos bytes de firma
 * ("GP"), versión, banderas, el srs_id y un envolvente opcional cuyo tamaño
 * depende de tres bits de las banderas. Saltarse esa cabecera de longitud
 * variable es todo lo que hace falta para quedarse con WKB que PostGIS entiende
 * sin intermediarios.
 *
 * Referencia: OGC GeoPackage 1.2, sección 2.1.3 (BLOB de geometría).
 */
function extractWkb(blob: Buffer): { wkb: Buffer; srsId: number } {
  if (blob.length < 8 || blob[0] !== 0x47 || blob[1] !== 0x50) {
    throw new Error('El blob no tiene la firma "GP" de GeoPackage');
  }

  const flags = blob[3];
  const littleEndian = (flags & 0x01) === 1;
  const srsId = littleEndian ? blob.readInt32LE(4) : blob.readInt32BE(4);

  // Bits 1-3: 0 sin envolvente, 1 xy (32 B), 2 xyz (48 B), 3 xym (48 B), 4 xyzm (64 B).
  const envelopeCode = (flags >> 1) & 0x07;
  const envelopeBytes = [0, 32, 48, 48, 64][envelopeCode];
  if (envelopeBytes === undefined) {
    throw new Error(`Código de envolvente no soportado: ${envelopeCode}`);
  }

  return { wkb: blob.subarray(8 + envelopeBytes), srsId };
}

function pickColumn(columns: string[], candidates: string[]): string | null {
  return candidates.find((candidate) => columns.includes(candidate)) ?? null;
}

async function ingestCoverage(
  manager: EntityManager,
  dataset: HdxDamageDataset,
  maskPath: string,
): Promise<void> {
  const raw = JSON.parse(readFileSync(maskPath, 'utf8')) as {
    features?: { geometry: unknown }[];
    geometry?: unknown;
  };
  const geometry = raw.features?.[0]?.geometry ?? raw.geometry ?? raw;

  await manager.query('DELETE FROM damage_coverage WHERE "datasetId" = $1', [dataset.datasetId]);
  await manager.query(
    `INSERT INTO damage_coverage
       ("datasetId", city, department, publisher, "imagerySource", "imageryDate",
        "buildingsAssessed", area)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
       ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($8), 4326))::geography)`,
    [
      dataset.datasetId,
      dataset.city,
      dataset.department,
      dataset.publisher,
      dataset.imagerySource,
      dataset.imageryDate,
      dataset.buildingsAssessed,
      JSON.stringify(geometry),
    ],
  );
}

async function ingestOne(
  manager: EntityManager,
  dataset: HdxDamageDataset,
  gpkgPath: string,
): Promise<number> {
  const db = new Database(gpkgPath, { readonly: true });

  try {
    const geometryInfo = db
      .prepare('SELECT table_name, column_name, srs_id FROM gpkg_geometry_columns LIMIT 1')
      .get() as { table_name: string; column_name: string; srs_id: number } | undefined;

    if (!geometryInfo) {
      throw new Error(`${dataset.city}: el GeoPackage no declara columnas de geometría`);
    }

    const columns = (
      db.prepare(`PRAGMA table_info("${geometryInfo.table_name}")`).all() as { name: string }[]
    ).map((c) => c.name);

    // Los nombres varían entre publicaciones; se resuelven por candidatos en
    // vez de asumir un esquema fijo.
    const damagedColumn = pickColumn(columns, ['damaged', 'is_damaged', 'damage']);
    const ratioColumn = pickColumn(columns, ['damage_pct_0m', 'damage_pct', 'damage_ratio']);
    const unknownColumn = pickColumn(columns, ['unknown_pct', 'unknown_ratio']);
    const idColumn = pickColumn(columns, ['id', 'building_id', 'fid']);

    if (!damagedColumn) {
      throw new Error(
        `${dataset.city}: no se encontró la columna de daño entre ${columns.join(', ')}`,
      );
    }

    const select = [
      `"${geometryInfo.column_name}" AS geom`,
      idColumn ? `"${idColumn}" AS building_id` : `NULL AS building_id`,
      ratioColumn ? `"${ratioColumn}" AS ratio` : `NULL AS ratio`,
      unknownColumn ? `"${unknownColumn}" AS unknown_ratio` : `NULL AS unknown_ratio`,
    ].join(', ');

    const rows = db
      .prepare(`SELECT ${select} FROM "${geometryInfo.table_name}" WHERE "${damagedColumn}" = 1`)
      .all() as {
      geom: Buffer;
      building_id: string | number | null;
      ratio: number | null;
      unknown_ratio: number | null;
    }[];

    // Re-ingerir reemplaza: si HDX publica una corrección, no se acumulan dos
    // versiones del mismo edificio en el mapa.
    await manager.query('DELETE FROM damage_assessments WHERE "datasetId" = $1', [
      dataset.datasetId,
    ]);

    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const batch = rows.slice(start, start + BATCH_SIZE);
      const values: string[] = [];
      const params: unknown[] = [];

      for (const row of batch) {
        const { wkb, srsId } = extractWkb(row.geom);
        const base = params.length;

        // ST_Force2D descarta la dimensión Z si la huella la trae: la columna
        // de destino es 2D y rechazaría una geometría 3D. ST_Multi normaliza
        // los polígonos simples a MultiPolygon, que es el tipo declarado.
        values.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6},
            $${base + 7}, $${base + 8}, $${base + 9}, true, $${base + 10},
            ST_Multi(ST_Force2D(ST_Transform(ST_GeomFromWKB($${base + 11}::bytea, $${base + 12}::int), 4326)))::geography)`,
        );

        params.push(
          dataset.datasetId,
          dataset.publisher,
          dataset.imagerySource,
          dataset.footprintSource,
          dataset.city,
          dataset.department,
          row.building_id !== null ? String(row.building_id) : null,
          dataset.imageryDate,
          row.ratio,
          row.unknown_ratio,
          wkb,
          srsId,
        );
      }

      await manager.query(
        `INSERT INTO damage_assessments
           ("datasetId", publisher, "imagerySource", "footprintSource", city, department,
            "buildingId", "imageryDate", "damageRatio", damaged, "unknownRatio", footprint)
         VALUES ${values.join(', ')}`,
        params,
      );
    }

    return rows.length;
  } finally {
    db.close();
  }
}

export interface DamageIngestResult {
  inserted: number;
  bytesDownloaded: number;
  sourceVersion: string | null;
}

export async function ingestHdxDamage(
  dataSource: DataSource,
  options: { logger?: IngestLogger; force?: boolean } = {},
): Promise<DamageIngestResult> {
  const logger = options.logger ?? consoleLogger;

  // La versión de referencia es la del dataset de Cali; los dos se publican
  // como parte de la misma respuesta y se recargan juntos.
  const sourceVersion = await fetchHdxVersion(DAMAGE_DATASETS[0].datasetId);

  let inserted = 0;
  let bytesDownloaded = 0;

  for (const dataset of DAMAGE_DATASETS) {
    const mask = await downloadCached({
      url: dataset.maskUrl,
      fileName: dataset.maskFileName,
      label: `${dataset.city} (área evaluada)`,
      logger,
      force: options.force,
    });
    const gpkg = await downloadCached({
      url: dataset.url,
      fileName: dataset.fileName,
      label: dataset.city,
      logger,
      force: options.force,
    });

    bytesDownloaded += (mask.downloaded ? mask.bytes : 0) + (gpkg.downloaded ? gpkg.bytes : 0);

    // Área y edificaciones se reemplazan en la misma transacción: dejar una
    // cobertura sin su daño, o al revés, produciría un mapa que se contradice.
    const count = await dataSource.transaction(async (manager) => {
      await ingestCoverage(manager, dataset, mask.path);
      return ingestOne(manager, dataset, gpkg.path);
    });

    inserted += count;
    logger.log(`  ${dataset.city}: ${count} edificaciones con daño`);
  }

  return { inserted, bytesDownloaded, sourceVersion };
}
