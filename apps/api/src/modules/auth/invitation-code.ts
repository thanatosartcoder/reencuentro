import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Código de verificación que acompaña —por otro canal— al enlace de invitación.
 *
 * El enlace por sí solo no basta. Un enlace es un texto: se reenvía, se filtra
 * en una captura de pantalla, queda en el historial de un grupo. Quien lo tenga
 * se convertiría en validador con acceso al documento y el teléfono de familias
 * que reportaron a un desaparecido.
 *
 * Por eso la credencial va partida: el enlace por un canal (correo) y este
 * código por otro (llamada, radio, en persona). Reenviar el chat ya no alcanza
 * — hay que haber estado en las dos conversaciones.
 *
 * El alfabeto omite los caracteres que se confunden al dictarlos en voz alta
 * (0/O, 1/I/L, 5/S, 8/B). En una emergencia esto se lee por teléfono con mala
 * señal, y un código que hay que repetir tres veces es un código que la gente
 * termina mandando por escrito — justo lo que se quiere evitar.
 */

const ALPHABET = '23467 9ACDEFGHJKMNPQRTUVWXYZ'.replace(/ /g, '');

/** Seis caracteres del alfabeto seguro: ~4.6 × 10⁸ combinaciones. */
const CODE_LENGTH = 6;

/**
 * Intentos antes de anular la invitación.
 *
 * Con seis caracteres y cinco intentos, adivinar es inviable. Al agotarlos la
 * invitación muere y hay que emitir otra: así el coordinador se entera de que
 * alguien estuvo probando.
 */
export const MAX_INVITATION_ATTEMPTS = 5;

export function generateVerificationCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    // randomInt usa el CSPRNG del sistema y evita el sesgo del módulo.
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/**
 * Normaliza lo que la persona escribió.
 *
 * Acepta minúsculas, espacios y el guion con que se muestra agrupado. También
 * corrige las confusiones que el alfabeto evita: quien oye "cero" teclea 0
 * aunque el código lleve O. Rechazar eso sería castigar a la persona por una
 * ambigüedad que introdujimos nosotros al dictar.
 */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/0/g, 'Q')
    .replace(/O/g, 'Q')
    .replace(/[1IL]/g, 'J')
    .replace(/5/g, 'S')
    .replace(/8/g, 'B');
}

/** Igual que arriba, aplicado al código generado, para comparar peras con peras. */
function canonical(code: string): string {
  return normalizeCode(code);
}

export function hashCode(code: string): string {
  return createHash('sha256').update(canonical(code)).digest('hex');
}

/** Comparación en tiempo constante: el hash no debe filtrar cuántos aciertos hubo. */
export function codeMatches(input: string, storedHash: string): boolean {
  const a = Buffer.from(hashCode(input), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Formato para mostrar y dictar: `A2C-4EF`. */
export function formatCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}
