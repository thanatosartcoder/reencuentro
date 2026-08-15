import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { ingestHdxDamage } from 'src/modules/ingest/hdx-damage.ingester';
import { recordIngestRun } from 'src/modules/ingest/record-run';
import { IngestSource, IngestStatus } from 'src/modules/ingest/entities/ingest-run.entity';

/**
 * Ejecuta a mano la ingesta de daño de HDX.
 *
 * La lógica vive en `modules/ingest/hdx-damage.ingester.ts`, que es la misma que
 * usa el cron diario: si estuviera duplicada aquí, una corrección aplicada en un
 * sitio y no en el otro produciría cargas distintas según quién las dispare.
 *
 * Uso:  npm run ingest:hdx  [-- --force]
 */
async function main(): Promise<void> {
  const force = process.argv.includes('--force');

  console.log('Ingiriendo evaluaciones de daño desde HDX…');
  await AppDataSource.initialize();

  const startedAt = new Date();
  try {
    const result = await ingestHdxDamage(AppDataSource, { force });

    // Se registra igual que si lo hubiera hecho el cron: si no, la detección de
    // cambios se queda sin versión con la que comparar y la próxima ejecución
    // automática vuelve a descargarlo todo.
    await recordIngestRun(AppDataSource, {
      source: IngestSource.HDX_DAMAGE,
      status: IngestStatus.SUCCESS,
      trigger: 'manual',
      sourceVersion: result.sourceVersion,
      recordsLoaded: result.inserted,
      bytesDownloaded: result.bytesDownloaded,
      startedAt,
    });

    console.log(`\nListo: ${result.inserted} edificaciones dañadas cargadas.`);
    console.log(
      'Recuerda: son estimaciones de un modelo sobre imagen satelital, no inspecciones.',
    );
  } catch (error) {
    await recordIngestRun(AppDataSource, {
      source: IngestSource.HDX_DAMAGE,
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
