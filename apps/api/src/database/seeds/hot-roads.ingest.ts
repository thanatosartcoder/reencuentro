import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { ingestHotRoads } from 'src/modules/ingest/hot-roads.ingester';
import { recordIngestRun } from 'src/modules/ingest/record-run';
import { IngestSource, IngestStatus } from 'src/modules/ingest/entities/ingest-run.entity';

/**
 * Ejecuta a mano la ingesta de la red vial de HOT.
 *
 * La lógica vive en `modules/ingest/hot-roads.ingester.ts`, compartida con el
 * cron diario.
 *
 * Uso:  npm run ingest:vias  [-- --force]
 */
async function main(): Promise<void> {
  const force = process.argv.includes('--force');

  console.log('Ingiriendo la red vial de HOT (OpenStreetMap)…');
  await AppDataSource.initialize();

  const startedAt = new Date();
  try {
    const result = await ingestHotRoads(AppDataSource, { force });

    await recordIngestRun(AppDataSource, {
      source: IngestSource.HOT_ROADS,
      status: IngestStatus.SUCCESS,
      trigger: 'manual',
      sourceVersion: result.sourceVersion,
      recordsLoaded: result.inserted,
      bytesDownloaded: result.bytesDownloaded,
      startedAt,
    });

    console.log(
      `\nListo: ${result.inserted.toLocaleString('es-CO')} tramos cargados ` +
        `de ${result.read.toLocaleString('es-CO')} leídos ` +
        `(${result.skipped.toLocaleString('es-CO')} descartados: andenes, senderos y vías de servicio).`,
    );

    const [summary] = await AppDataSource.query<{ km: string; nombradas: string }[]>(
      `SELECT round((SUM("lengthMeters") / 1000)::numeric, 0) AS km,
              COUNT(*) FILTER (WHERE name IS NOT NULL) AS nombradas
       FROM road_segments`,
    );
    console.log(
      `  ${Number(summary.km).toLocaleString('es-CO')} km de red vial · ` +
        `${Number(summary.nombradas).toLocaleString('es-CO')} tramos con nombre`,
    );
    console.log('\n  Datos © colaboradores de OpenStreetMap, licencia ODbL.');
  } catch (error) {
    await recordIngestRun(AppDataSource, {
      source: IngestSource.HOT_ROADS,
      status: IngestStatus.FAILED,
      trigger: 'manual',
      error: error instanceof Error ? error.message : String(error),
      startedAt,
    }).catch(() => undefined);
    throw error;
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error('La ingesta falló:', error);
  process.exit(1);
});
