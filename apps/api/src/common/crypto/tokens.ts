import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Claim token: la credencial que recibe quien reporta una desaparicion.
 *
 * Reemplaza al registro de usuario. Con este token la persona sigue su caso y
 * recibe la notificacion cuando hay novedades, sin haber creado cuenta ni dado
 * mas datos de los que ya entrego en el reporte. En una emergencia, cada paso
 * adicional antes de poder reportar se traduce en reportes que no se hacen.
 *
 * En la base solo queda el hash: si alguien lee la tabla no puede suplantar al
 * reportante ni acceder a su caso.
 */
export function generateClaimToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Comparacion en tiempo constante, para no filtrar informacion por latencia. */
export function tokensMatch(rawToken: string, storedHash: string): boolean {
  const computed = Buffer.from(hashToken(rawToken), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

/** Identificador anonimo y estable para un dispositivo que aun no tiene uno. */
export function generateDeviceId(): string {
  return randomBytes(16).toString('hex');
}
