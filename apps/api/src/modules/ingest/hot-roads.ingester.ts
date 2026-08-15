import { createReadStream, createWriteStream, existsSync, statSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { open as openZip, type Entry, type ZipFile } from 'yauzl';
import { parserStream } from 'stream-json';
import { pick } from 'stream-json/filters/pick.js';
import { streamArray } from 'stream-json/streamers/stream-array.js';
import type { DataSource, EntityManager } from 'typeorm';
import {
  CACHE_ROOT,
  consoleLogger,
  downloadCached,
  fetchHdxVersion,
  mb,
  type IngestLogger,
} from './hdx-client';

/**
 * Ingesta de la red vial que HOT exportó de OpenStreetMap para esta emergencia.
 *
 * El archivo son 134 MB de GeoJSON en un solo renglón con 238.617 tramos, así
 * que se procesa por streaming: `JSON.parse` sobre eso reservaría cerca de un
 * gigabyte de objetos antes de poder filtrar nada.
 *
 * Se descartan las clases que no sirven para llegar a un sitio en vehículo
 * —andenes, escaleras, senderos peatonales, vías de servicio— y se conserva
 * todo lo que conecta: desde la troncal hasta la trocha. En Chocó la diferencia
 * entre una `track` y nada es la diferencia entre poder entrar o no.
 *
 * Fuente: HOT Raw Data API sobre OpenStreetMap. Licencia ODbL.
 */

export const HOT_ROADS_DATASET_ID = 'col-earthquake-august-2026-openstreetmap-data';

const DATASET_URL =
  'https://data.humdata.org/dataset/e8bdd009-7844-40d5-9093-80a692ace688/resource/a47602bc-7436-4a79-95c6-145836a1269d/download/colombia_eq_roads_13aug2026_geojson.zip';

const EXPORTED_AT = '2026-08-13T10:23:29.000Z';

const ZIP_NAME = 'hot-roads.zip';
const GEOJSON_FILE = join(CACHE_ROOT, 'hot-roads.geojson');

/**
 * Clases que se descartan.
 *
 * Ninguna sirve para responder "¿puede llegar un vehículo hasta aquí?", que es
 * la única pregunta que este dato tiene que ayudar a contestar.
 */
const EXCLUDED_HIGHWAYS = new Set([
  'footway',
  'path',
  'steps',
  'pedestrian',
  'cycleway',
  'bridleway',
  'corridor',
  'platform',
  'service',
  'proposed',
  'construction',
]);

const BATCH_SIZE = 500;

interface RoadFeature {
  geometry: { type: string; coordinates: [number, number][] } | null;
  properties: {
    osm_id: number;
    highway: string | null;
    name: string | null;
    surface: string | null;
    oneway: string | null;
    bridge: string | null;
    tunnel: string | null;
  };
}

/** Extrae el .geojson del zip por streaming, sin cargarlo entero en memoria. */
function extract(zipPath: string, logger: IngestLogger, force: boolean): Promise<void> {
  if (!force && existsSync(GEOJSON_FILE) && statSync(GEOJSON_FILE).size > 0) {
    logger.log(`  geojson ya extraído (${mb(statSync(GEOJSON_FILE).size)})`);
    return Promise.resolve();
  }

  logger.log('  extrayendo…');
  return new Promise<void>((resolve, reject) => {
    openZip(zipPath, { lazyEntries: true }, (error, zip: ZipFile) => {
      if (error) return reject(error);

      zip.on('entry', (entry: Entry) => {
        if (!entry.fileName.endsWith('.geojson') || entry.fileName.includes('clipping')) {
          return zip.readEntry();
        }
        zip.openReadStream(entry, (streamError, readStream) => {
          if (streamError) return reject(streamError);
          pipeline(readStream, createWriteStream(GEOJSON_FILE))
            .then(() => {
              logger.log(`  extraído (${mb(statSync(GEOJSON_FILE).size)})`);
              zip.close();
              resolve();
            })
            .catch(reject);
        });
      });

      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

async function flush(manager: EntityManager, batch: RoadFeature[]): Promise<number> {
  if (!batch.length) return 0;

  const values: string[] = [];
  // El dataset es el mismo para todas las filas del lote, así que ocupa $1 y
  // cada tupla lo referencia. Repetirlo por fila añadiría ciento sesenta mil
  // copias de la misma cadena sin ganar nada.
  const params: unknown[] = [HOT_ROADS_DATASET_ID];

  for (const feature of batch) {
    const p = feature.properties;
    const base = params.length;

    // La longitud la calcula PostGIS sobre la geografía: da metros reales sobre
    // el elipsoide, no grados, que es lo que haría un cálculo plano.
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8},
        ST_GeomFromGeoJSON($${base + 9})::geography,
        ST_Length(ST_GeomFromGeoJSON($${base + 9})::geography))`,
    );

    params.push(
      String(p.osm_id),
      p.highway,
      p.name,
      p.surface,
      // En OSM el puente y el túnel son etiquetas de texto ("yes", "viaduct"),
      // no booleanos: cualquier valor distinto de "no" significa que lo es.
      p.bridge != null && p.bridge !== 'no',
      p.tunnel != null && p.tunnel !== 'no',
      p.oneway,
      EXPORTED_AT,
      JSON.stringify(feature.geometry),
    );
  }

  await manager.query(
    `INSERT INTO road_segments
       ("osmId", highway, name, surface, "isBridge", "isTunnel", oneway, "exportedAt", path, "lengthMeters",
        "datasetId")
     VALUES ${values.join(', ')}
     ON CONFLICT ("osmId") DO NOTHING`,
    params,
  );

  return batch.length;
}

export interface RoadsIngestResult {
  read: number;
  inserted: number;
  skipped: number;
  bytesDownloaded: number;
  sourceVersion: string | null;
}

export async function ingestHotRoads(
  dataSource: DataSource,
  options: { logger?: IngestLogger; force?: boolean } = {},
): Promise<RoadsIngestResult> {
  const logger = options.logger ?? consoleLogger;
  const sourceVersion = await fetchHdxVersion(HOT_ROADS_DATASET_ID);

  const download = await downloadCached({
    url: DATASET_URL,
    fileName: ZIP_NAME,
    label: 'red vial',
    logger,
    force: options.force,
  });

  // Si el zip se volvió a bajar, el geojson extraído anterior ya no corresponde.
  await extract(download.path, logger, download.downloaded);

  logger.log('  cargando en PostGIS…');

  let read = 0;
  let inserted = 0;
  let skipped = 0;

  /**
   * Todo el reemplazo va dentro de una transacción.
   *
   * `TRUNCATE` es transaccional en Postgres, así que si el parseo falla a mitad
   * de camino la red vial anterior sigue intacta en lugar de quedar a medias.
   * El precio es que la tabla queda bloqueada para lectura mientras dura la
   * carga —alrededor de un minuto— y por eso el cron corre de madrugada.
   */
  await dataSource.transaction(async (manager) => {
    await manager.query('TRUNCATE road_segments');

    let batch: RoadFeature[] = [];

    // `pick` descarta todo lo que no sea el arreglo `features` antes de
    // ensamblar objetos, así que los 134 MB nunca existen como estructura en
    // memoria: solo pasa un tramo a la vez.
    const stream = createReadStream(GEOJSON_FILE)
      .pipe(parserStream())
      .pipe(pick.asStream({ filter: 'features' }))
      .pipe(streamArray.asStream());

    for await (const chunk of stream) {
      const feature = (chunk as { value: RoadFeature }).value;
      read++;

      const highway = feature.properties?.highway;
      const geometry = feature.geometry;

      if (
        !highway ||
        EXCLUDED_HIGHWAYS.has(highway) ||
        geometry?.type !== 'LineString' ||
        // Una geometría de un solo punto no es un tramo y PostGIS la rechazaría.
        (geometry.coordinates?.length ?? 0) < 2
      ) {
        skipped++;
        continue;
      }

      batch.push(feature);

      if (batch.length >= BATCH_SIZE) {
        inserted += await flush(manager, batch);
        batch = [];
        if (inserted % 25_000 === 0) {
          logger.log(`    ${inserted.toLocaleString('es-CO')} tramos…`);
        }
      }
    }

    inserted += await flush(manager, batch);
  });

  // El geojson de 134 MB solo hace falta durante la carga. El zip se conserva
  // porque es lo que permite saltarse la descarga si nada cambió.
  if (existsSync(GEOJSON_FILE)) unlinkSync(GEOJSON_FILE);

  return {
    read,
    inserted,
    skipped,
    bytesDownloaded: download.downloaded ? download.bytes : 0,
    sourceVersion,
  };
}
