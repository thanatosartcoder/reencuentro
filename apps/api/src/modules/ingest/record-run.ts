import type { DataSource } from 'typeorm';
import { IngestRun, IngestSource, IngestStatus } from './entities/ingest-run.entity';

/**
 * Registra una ejecución de ingesta.
 *
 * Existe para que la consola y el cron dejen el mismo rastro. Cuando solo lo
 * hacía el cron, una carga lanzada a mano quedaba invisible: el panel decía
 * "nunca cargado" con los datos ya puestos, y —peor— la detección de cambios se
 * quedaba sin versión con la que comparar, así que la siguiente ejecución
 * automática volvía a descargar cientos de megabytes que ya estaban.
 *
 * La regla es la misma que motivó extraer los ingestores a un módulo común: si
 * hay dos caminos para hacer lo mismo, tienen que dejar el sistema en el mismo
 * estado.
 */
export async function recordIngestRun(
  dataSource: DataSource,
  input: {
    source: IngestSource;
    status: IngestStatus;
    trigger: 'cron' | 'manual';
    sourceVersion?: string | null;
    recordsLoaded?: number | null;
    bytesDownloaded?: number | null;
    error?: string | null;
    startedAt: Date;
  },
): Promise<void> {
  const finishedAt = new Date();
  const repo = dataSource.getRepository(IngestRun);

  await repo.save(
    repo.create({
      source: input.source,
      status: input.status,
      trigger: input.trigger,
      sourceVersion: input.sourceVersion ?? null,
      recordsLoaded: input.recordsLoaded ?? null,
      bytesDownloaded: input.bytesDownloaded ?? null,
      error: input.error ?? null,
      startedAt: input.startedAt,
      finishedAt,
      durationSeconds: Math.round((finishedAt.getTime() - input.startedAt.getTime()) / 1000),
    }),
  );
}
