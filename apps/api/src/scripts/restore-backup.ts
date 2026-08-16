import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { descifrarCopia } from '../modules/backup/backup-crypto';

/**
 * Abre una copia de seguridad cifrada.
 *
 * Existe porque cifrar sin un camino probado de vuelta no es proteger los datos:
 * es perderlos despacio. Este script es la mitad que se usa el peor día, así que
 * no depende de la aplicación —ni de la base, ni de las variables de entorno del
 * servidor, ni de que Nest arranque—. Solo Node, el archivo y la clave privada.
 *
 *   npx ts-node src/scripts/restore-backup.ts copia.sql.gz.enc clave-privada.pem [salida.sql]
 *
 * Y luego, lo de siempre:
 *
 *   psql "$DATABASE_URL" < salida.sql
 *
 * La clave privada se pasa como archivo y no por variable de entorno a
 * propósito: una variable queda en el historial del shell y en el listado de
 * procesos. Un archivo se borra cuando se termina.
 */

function principal(): void {
  const [entrada, clave, salida] = process.argv.slice(2);

  if (!entrada || !clave) {
    console.error(
      'Uso: restore-backup.ts <copia.sql.gz.enc> <clave-privada.pem> [salida.sql]\n\n' +
        'La clave privada NO está en el servidor: el servidor solo tiene la pública,\n' +
        'para poder escribir copias que no puede volver a leer. Búscala donde se\n' +
        'guardó al generarla.',
    );
    process.exit(1);
  }

  const sellada = readFileSync(entrada);
  const privada = readFileSync(clave, 'utf8');

  console.log(`Abriendo ${entrada} (${(sellada.length / 1024 ** 2).toFixed(1)} MB)…`);

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
  const destino = salida ?? entrada.replace(/\.gz\.enc$/, '').replace(/\.enc$/, '') + '.sql';
  writeFileSync(destino, sql);

  const tablas = (sql.toString('utf8').match(/^CREATE TABLE /gm) ?? []).length;
  console.log(
    `Listo: ${destino} · ${(sql.length / 1024 ** 2).toFixed(1)} MB · ${tablas} tablas\n\n` +
      `Restaurar con:\n  psql "$DATABASE_URL" < ${destino}`,
  );
}

principal();
