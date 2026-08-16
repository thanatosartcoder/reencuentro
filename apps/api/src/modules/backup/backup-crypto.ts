import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';

/**
 * Cifrado de las copias de seguridad.
 *
 * Una copia de esta base es, en un solo archivo, lo que cientos de familias
 * contaron sobre las personas que buscan. Los campos que identifican
 * directamente —documento, teléfono, correo— viajan cifrados por
 * `field-crypto`, pero el nombre, las circunstancias, las notas médicas y las
 * coordenadas van en claro: el volcado es un dossier completo, y hasta ahora
 * subía al almacenamiento de objetos tal cual.
 *
 * ## Por qué asimétrico
 *
 * La pregunta no es "cómo cifrar" sino "quién puede descifrar". Con una clave
 * simétrica en el entorno del servidor, quien comprometa el servidor obtiene a
 * la vez la base y la llave de todas las copias — no gana nada la víctima.
 *
 * Aquí el servidor tiene solo la **clave pública**: puede escribir copias que no
 * puede volver a leer. La privada vive fuera —un gestor de contraseñas, un sobre
 * en una caja fuerte— y solo aparece el día que haya que restaurar. Ese día
 * alguien tendrá que ir a buscarla, y esa fricción es exactamente el punto.
 *
 * ## Formato
 *
 *     REBK1 | claveCifrada(4B longitud + N) | iv(12B) | tag(16B) | ciphertext
 *
 * Híbrido porque RSA no cifra megabytes: se genera una clave AES-256-GCM al azar
 * por copia, se cifra el volcado con ella, y se cifra esa clave con la pública.
 * GCM y no CBC porque además de confidencialidad hace falta saber que el archivo
 * no se tocó: una copia alterada en silencio es peor que ninguna.
 *
 * La cabecera lleva versión para que un cambio de formato dentro de dos años no
 * obligue a adivinar con qué se cifró un archivo de hoy.
 */

const MAGIC = Buffer.from('REBK1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AES_KEY_BYTES = 32;

/** OAEP con SHA-256: el relleno PKCS#1 v1.5 tiene ataques conocidos y no se usa. */
const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' } as const;

/**
 * Clave pública con la que se sellan las copias, si está configurada.
 *
 * Devuelve null cuando no hay ninguna: un despliegue de desarrollo no necesita
 * cifrar sus volcados, y exigirlo solo conseguiría que alguien desactivara las
 * copias enteras para quitarse el estorbo.
 */
export function leerClavePublica(raw: string | undefined): string | null {
  const valor = raw?.trim();
  if (!valor) return null;

  // Se admite base64 además del PEM en crudo: un PEM tiene saltos de línea y
  // pegarlo en el panel de una plataforma es como llega roto.
  const pem = valor.includes('BEGIN') ? valor : Buffer.from(valor, 'base64').toString('utf8');

  // Se rechaza explícitamente una clave privada, y esta comprobación no es
  // paranoia: `createPublicKey()` acepta un PEM privado sin protestar, porque
  // sabe derivar la pública de él. Es decir, pegar el archivo entero aquí —el
  // error más natural del mundo— funcionaría, las copias se cifrarían bien, y
  // nadie se enteraría de que la clave privada quedó guardada en el servidor.
  // Y ahí se habría perdido lo único que este diseño protege: que comprometer
  // el servidor no entregue también el historial.
  if (/BEGIN [A-Z ]*PRIVATE KEY/.test(pem)) {
    throw new Error(
      'BACKUP_PUBLIC_KEY contiene una clave PRIVADA. Aquí va solo la pública: ' +
        'la privada no debe estar en el servidor, porque entonces cifrar las ' +
        'copias no protege de nada. Extrae la pública con: ' +
        'openssl rsa -in privada.pem -pubout',
    );
  }

  try {
    createPublicKey(pem);
  } catch {
    throw new Error(
      'BACKUP_PUBLIC_KEY no es una clave pública válida (PEM o su base64).',
    );
  }
  return pem;
}

/** Sella una copia. Solo quien tenga la privada podrá abrirla. */
export function cifrarCopia(contenido: Buffer, clavePublicaPem: string): Buffer {
  const claveAes = randomBytes(AES_KEY_BYTES);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv('aes-256-gcm', claveAes, iv);
  const ciphertext = Buffer.concat([cipher.update(contenido), cipher.final()]);
  const tag = cipher.getAuthTag();

  const claveCifrada = publicEncrypt(
    { key: createPublicKey(clavePublicaPem), ...OAEP },
    claveAes,
  );

  const longitud = Buffer.alloc(4);
  longitud.writeUInt32BE(claveCifrada.length);

  return Buffer.concat([MAGIC, longitud, claveCifrada, iv, tag, ciphertext]);
}

/**
 * Abre una copia sellada. Lo usa el script de restauración, nunca el servidor.
 *
 * Vive en el mismo archivo que el cifrado a propósito: un formato cuyo lector y
 * escritor están separados es un formato que acaba divergiendo, y se descubre el
 * día que hay que restaurar.
 */
export function descifrarCopia(sellado: Buffer, clavePrivadaPem: string): Buffer {
  if (!sellado.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error(
      'El archivo no tiene la cabecera REBK1. ¿Es una copia anterior al cifrado? Esas se abren con gunzip.',
    );
  }

  let offset = MAGIC.length;
  const longitudClave = sellado.readUInt32BE(offset);
  offset += 4;

  const claveCifrada = sellado.subarray(offset, offset + longitudClave);
  offset += longitudClave;

  const iv = sellado.subarray(offset, offset + IV_BYTES);
  offset += IV_BYTES;

  const tag = sellado.subarray(offset, offset + TAG_BYTES);
  offset += TAG_BYTES;

  const ciphertext = sellado.subarray(offset);

  const claveAes = privateDecrypt(
    { key: createPrivateKey(clavePrivadaPem), ...OAEP },
    claveCifrada,
  );

  const decipher = createDecipheriv('aes-256-gcm', claveAes, iv);
  decipher.setAuthTag(tag);

  // `final()` lanza si el tag no cuadra: es lo que detecta que el archivo se
  // alteró o se truncó, en vez de devolver basura que parece un volcado.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
