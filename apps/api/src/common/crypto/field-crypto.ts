import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { ValueTransformer } from 'typeorm';

/**
 * Cifrado de campos en reposo para datos personales sensibles.
 *
 * La Ley 1581 de 2012 clasifica como sensibles los datos de salud, biometricos
 * y los de menores de edad; en una emergencia este sistema almacena las tres
 * cosas. Los campos que identifican directamente a una persona (documento,
 * telefono, correo) se guardan cifrados con AES-256-GCM.
 *
 * Un campo cifrado deja de ser buscable, asi que cuando ademas necesitamos
 * igualdad exacta (buscar por cedula, deduplicar por telefono) guardamos junto
 * al ciphertext un "blind index": un HMAC-SHA256 de la forma normalizada del
 * valor. Permite comparar sin revelar el contenido y es indexable en Postgres.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY no esta definida. Genera una con: openssl rand -hex 32',
    );
  }
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) {
    throw new Error('FIELD_ENCRYPTION_KEY debe ser de 32 bytes en hexadecimal (64 caracteres)');
  }
  cachedKey = key;
  return key;
}

/** Devuelve `v1.<iv>.<tag>.<ciphertext>` en base64url. */
export function encryptField(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptField(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Payload cifrado con formato invalido');
  }

  const tag = Buffer.from(tagB64, 'base64url');
  if (tag.length !== TAG_BYTES) throw new Error('Tag de autenticacion invalido');

  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Indice ciego para busquedas por igualdad sobre un campo cifrado.
 * Se deriva de la misma clave maestra pero con un dominio separado, para que
 * conocer el indice no ayude a descifrar el valor.
 */
export function blindIndex(normalizedValue: string): string {
  return createHmac('sha256', getKey())
    .update(`blind-index:${normalizedValue}`)
    .digest('hex');
}

/**
 * Transformer de TypeORM: la entidad expone texto plano, la columna guarda
 * ciphertext. Si el descifrado falla (clave rotada, dato corrupto) devuelve
 * null en lugar de tumbar la consulta: en una emergencia vale mas leer el
 * resto del reporte que perderlo entero.
 */
export const encryptedText: ValueTransformer = {
  to(value: string | null | undefined): string | null {
    if (value === null || value === undefined || value === '') return null;
    return encryptField(value);
  },
  from(value: string | null): string | null {
    if (!value) return null;
    try {
      return decryptField(value);
    } catch {
      return null;
    }
  },
};
