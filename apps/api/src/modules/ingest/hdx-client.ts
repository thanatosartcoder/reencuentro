import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Utilidades compartidas por las ingestas del Humanitarian Data Exchange.
 *
 * Lo importante que vive aquí es la detección de cambios. Un cron diario que
 * descarga 160 MB sin preguntar si hay algo nuevo desperdicia ancho de banda de
 * HDX —una plataforma humanitaria sin ánimo de lucro— y del servidor propio,
 * todas las noches, para reescribir los mismos datos. Preguntar primero cuesta
 * una petición de dos kilobytes.
 */

export const CACHE_ROOT = join(tmpdir(), 'reencuentro-ingest');

export interface IngestLogger {
  log: (message: string) => void;
  warn: (message: string) => void;
}

export const consoleLogger: IngestLogger = {
  log: (message) => console.log(message),
  warn: (message) => console.warn(message),
};

/**
 * Versión publicada de un dataset de HDX.
 *
 * `metadata_modified` cambia cuando el publicador sube una corrección o un
 * recorte nuevo, que es exactamente cuándo vale la pena volver a descargar.
 */
export async function fetchHdxVersion(datasetId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://data.humdata.org/api/3/action/package_show?id=${encodeURIComponent(datasetId)}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    if (!response.ok) return null;

    const body = (await response.json()) as {
      result?: { metadata_modified?: string };
    };
    return body.result?.metadata_modified ?? null;
  } catch {
    // Sin respuesta de HDX no se puede saber si cambió. Devolver null hace que
    // la ingesta siga adelante: es preferible una descarga de más que quedarse
    // con datos viejos por un fallo de red transitorio.
    return null;
  }
}

export function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * Descarga con caché en disco.
 *
 * `force` la salta cuando la versión del dataset cambió: si no, un archivo
 * viejo en `/tmp` haría que la ingesta "exitosa" recargara los mismos datos de
 * siempre sin que nadie lo note.
 */
export async function downloadCached(options: {
  url: string;
  fileName: string;
  label: string;
  logger: IngestLogger;
  force?: boolean;
  timeoutMs?: number;
}): Promise<{ path: string; bytes: number; downloaded: boolean }> {
  mkdirSync(CACHE_ROOT, { recursive: true });
  const path = join(CACHE_ROOT, options.fileName);

  if (!options.force && existsSync(path) && statSync(path).size > 0) {
    const bytes = statSync(path).size;
    options.logger.log(`  ${options.label}: copia en caché (${mb(bytes)})`);
    return { path, bytes, downloaded: false };
  }

  options.logger.log(`  ${options.label}: descargando…`);
  const response = await fetch(options.url, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 600_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`HDX respondió ${response.status} para ${options.label}`);
  }

  // Se escribe a un archivo temporal y se renombra al final: si la descarga se
  // corta a la mitad, no queda un archivo truncado que la próxima ejecución
  // tomaría por válido desde la caché.
  const partial = `${path}.partial`;
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partial));

  const { renameSync } = await import('node:fs');
  renameSync(partial, path);

  const bytes = statSync(path).size;
  options.logger.log(`  ${options.label}: descargado (${mb(bytes)})`);
  return { path, bytes, downloaded: true };
}
