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
 *
 * ## Dos claves, y por qué
 *
 * **La clave de cifrado rota.** Cada ciphertext lleva delante el identificador
 * de la clave con que se cifró, así que conviven valores de varias claves y
 * rotar no obliga a reescribir la base de golpe. Es lo que hace falta el día
 * que se sospeche que una clave se filtró.
 *
 * **La clave del índice ciego NO rota con ella**, y esto es deliberado. El
 * motor de coincidencias no usa el índice solo para buscar: *compara* el hash
 * del reporte con el del avistamiento para decidir si son la misma persona. Si
 * dos filas tuvieran índices derivados de claves distintas, el mismo documento
 * produciría hashes distintos y el sistema dejaría de reconocer a una persona
 * que sí está reportada dos veces. En una plataforma de desaparecidos eso no es
 * un bug de búsqueda: es una familia que no recibe el aviso.
 *
 * Por eso el índice usa una clave propia y estable. Rotarla es una operación
 * aparte, atómica, que reescribe todos los índices a la vez (ver
 * `scripts/rotate-keys.ts`).
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** `v1`, `v2`… Sin puntos: el punto separa los campos del payload. */
const KEY_ID = /^[a-z0-9_-]+$/i;

interface Keyring {
  keys: Map<string, Buffer>;
  /** Con cuál se cifra lo nuevo. */
  activeId: string;
  /** Con cuál se derivan los índices ciegos. Estable entre rotaciones. */
  indexKey: Buffer;
}

let cached: Keyring | null = null;

/** Solo para pruebas y para el rotador, que cambia el entorno en caliente. */
export function resetKeyringCache(): void {
  cached = null;
}

function parseKey(raw: string, etiqueta: string): Buffer {
  const key = Buffer.from(raw.trim(), 'hex');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${etiqueta} debe ser de 32 bytes en hexadecimal (64 caracteres)`,
    );
  }
  return key;
}

function loadKeyring(): Keyring {
  if (cached) return cached;

  const keys = new Map<string, Buffer>();

  // Formato del llavero: "v1:<hex>,v2:<hex>". Se admite la variable antigua
  // FIELD_ENCRYPTION_KEY como v1 para que un despliegue existente siga
  // arrancando sin tocar nada — y para que los ciphertext ya guardados, que
  // llevan el prefijo v1, sigan descifrándose.
  const ring = process.env.FIELD_ENCRYPTION_KEYS?.trim();
  if (ring) {
    for (const entry of ring.split(',')) {
      const [id, hex] = entry.split(':');
      if (!id || !hex) {
        throw new Error(
          'FIELD_ENCRYPTION_KEYS mal formada. Se espera "v1:<hex>,v2:<hex>"',
        );
      }
      if (!KEY_ID.test(id.trim())) {
        throw new Error(`Identificador de clave inválido: ${id}`);
      }
      keys.set(id.trim(), parseKey(hex, `La clave ${id.trim()}`));
    }
  }

  const legacy = process.env.FIELD_ENCRYPTION_KEY?.trim();
  if (legacy && !keys.has('v1')) {
    keys.set('v1', parseKey(legacy, 'FIELD_ENCRYPTION_KEY'));
  }

  if (keys.size === 0) {
    throw new Error(
      'No hay claves de cifrado. Define FIELD_ENCRYPTION_KEY (o FIELD_ENCRYPTION_KEYS). ' +
        'Genera una con: openssl rand -hex 32',
    );
  }

  // Activa: la indicada, o la última declarada.
  const activeId = process.env.FIELD_ENCRYPTION_ACTIVE?.trim() || [...keys.keys()].pop()!;
  if (!keys.has(activeId)) {
    throw new Error(
      `FIELD_ENCRYPTION_ACTIVE apunta a "${activeId}", que no está en el llavero.`,
    );
  }

  // Clave del índice ciego. Por defecto la v1, que es con la que se calcularon
  // todos los índices existentes: cambiar este valor sin reescribirlos deja el
  // motor de coincidencias ciego.
  const indexRaw = process.env.FIELD_INDEX_KEY?.trim();
  const indexKey = indexRaw
    ? parseKey(indexRaw, 'FIELD_INDEX_KEY')
    : (keys.get('v1') ?? keys.get(activeId)!);

  cached = { keys, activeId, indexKey };
  return cached;
}

/** Identificadores de clave disponibles, y cuál cifra lo nuevo. */
export function keyringInfo(): { ids: string[]; activeId: string } {
  const ring = loadKeyring();
  return { ids: [...ring.keys.keys()], activeId: ring.activeId };
}

/** Devuelve `<keyId>.<iv>.<tag>.<ciphertext>` en base64url. */
export function encryptField(plain: string): string {
  const { keys, activeId } = loadKeyring();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keys.get(activeId)!, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    activeId,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptField(payload: string): string {
  const [keyId, ivB64, tagB64, dataB64] = payload.split('.');
  if (!keyId || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Payload cifrado con formato invalido');
  }

  const { keys } = loadKeyring();
  const key = keys.get(keyId);
  if (!key) {
    // Mensaje explícito: este es el error que aparece cuando alguien retira una
    // clave del llavero antes de reescribir lo que quedaba cifrado con ella.
    throw new Error(
      `El dato está cifrado con la clave "${keyId}", que no está en el llavero.`,
    );
  }

  const tag = Buffer.from(tagB64, 'base64url');
  if (tag.length !== TAG_BYTES) throw new Error('Tag de autenticacion invalido');

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Con qué clave se cifró un valor, sin descifrarlo. */
export function keyIdOf(payload: string): string | null {
  const id = payload.split('.')[0];
  return id && KEY_ID.test(id) ? id : null;
}

/**
 * Indice ciego para busquedas por igualdad sobre un campo cifrado.
 *
 * Deriva de una clave propia y con un dominio separado, para que conocer el
 * indice no ayude a descifrar el valor. Ver la nota de arriba sobre por qué no
 * rota junto con las claves de cifrado.
 */
export function blindIndex(normalizedValue: string): string {
  return createHmac('sha256', loadKeyring().indexKey)
    .update(`blind-index:${normalizedValue}`)
    .digest('hex');
}

/** Igual que `blindIndex` pero con una clave concreta, para reindexar. */
export function blindIndexWith(key: Buffer, normalizedValue: string): string {
  return createHmac('sha256', key)
    .update(`blind-index:${normalizedValue}`)
    .digest('hex');
}

/**
 * Transformer de TypeORM: la entidad expone texto plano, la columna guarda
 * ciphertext. Si el descifrado falla (clave retirada, dato corrupto) devuelve
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
