import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { config as loadEnv } from 'dotenv';
import { descifrarCopia } from '../modules/backup/backup-crypto';
import { S3StorageDriver } from '../modules/storage/s3-storage.driver';

loadEnv();

/**
 * Abre una copia de seguridad cifrada.
 *
 * Existe porque cifrar sin un camino probado de vuelta no es proteger los datos:
 * es perderlos despacio, y no se nota hasta el día en que hacen falta. Este
 * script es la mitad que se usa ese día, así que no depende de la aplicación —ni
 * de la base, ni de que Nest arranque—. Solo Node, el archivo y la clave.
 *
 *   npm run backup:restore -- <archivo|clave-del-bucket> <clave-privada.pem> [salida.sql]
 *
 * Con `--remoto` la descarga del almacenamiento de objetos en lugar de leerla
 * del disco, usando las mismas variables `S3_*` que la API. Es una comodidad,
 * no un atajo: el archivo sigue siendo indescifrable sin la clave privada, que
 * no está ni en el servidor ni en estas variables.
 *
 *   npm run backup:restore -- backups/reencuentro-2026-08-16-1529.sql.gz.enc privada.pem --remoto
 *
 * Y luego, lo de siempre:
 *
 *   psql "$DATABASE_URL" < salida.sql
 *
 * La clave privada se pasa como archivo y no por variable de entorno a
 * propósito: una variable queda en el historial del shell y en el listado de
 * procesos. Un archivo se borra cuando se termina.
 */

async function leerRemoto(clave: string): Promise<Buffer> {
  const faltan = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter(
    (v) => !process.env[v]?.trim(),
  );
  if (faltan.length) {
    throw new Error(
      `Para --remoto hacen falta ${faltan.join(', ')} en el entorno. ` +
        'Son las mismas credenciales que usa la API para escribir las copias.',
    );
  }

  const driver = new S3StorageDriver({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION ?? 'auto',
    bucket: process.env.S3_BUCKET!,
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  });

  const { stream } = await driver.getStream(clave);
  const partes: Buffer[] = [];
  for await (const trozo of stream) partes.push(trozo as Buffer);
  return Buffer.concat(partes);
}

async function principal(): Promise<void> {
  const args = process.argv.slice(2);
  const remoto = args.includes('--remoto');
  const [origen, clavePrivada, salida] = args.filter((a) => a !== '--remoto');

  if (!origen || !clavePrivada) {
    console.error(
      'Uso: backup:restore -- <archivo|clave-del-bucket> <clave-privada.pem> [salida.sql] [--remoto]\n\n' +
        'La clave privada NO está en el servidor: el servidor solo tiene la pública,\n' +
        'para poder escribir copias que no puede volver a leer. Búscala donde se\n' +
        'guardó al generarla.',
    );
    process.exit(1);
  }

  let sellada: Buffer;
  if (remoto) {
    console.log(`Descargando ${origen} del almacenamiento…`);
    sellada = await leerRemoto(origen);
  } else {
    sellada = readFileSync(origen);
  }

  const privada = readFileSync(clavePrivada, 'utf8');
  console.log(`Abriendo ${basename(origen)} (${(sellada.length / 1024 ** 2).toFixed(2)} MB)…`);

  let comprimida: Buffer;
  try {
    comprimida = descifrarCopia(sellada, privada);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    console.error(
      `\nNo se pudo descifrar: ${mensaje}\n\n` +
        'Las causas habituales, en orden de frecuencia:\n' +
        '  · la clave privada no es la pareja de la pública con que se selló\n' +
        '  · el archivo se truncó al descargarlo\n' +
        '  · el archivo fue alterado (el tag de GCM no cuadra)',
    );
    process.exit(1);
  }

  const sql = gunzipSync(comprimida);
  const destino =
    salida ?? basename(origen).replace(/\.gz\.enc$/, '').replace(/\.enc$/, '') + '.sql';
  writeFileSync(destino, sql);

  const tablas = (sql.toString('utf8').match(/^CREATE TABLE /gm) ?? []).length;
  console.log(
    `Listo: ${destino} · ${(sql.length / 1024 ** 2).toFixed(2)} MB · ${tablas} tablas\n\n` +
      `Restaurar con:\n  psql "$DATABASE_URL" < ${destino}`,
  );
}

principal().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
