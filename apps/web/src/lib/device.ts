const DEVICE_KEY = 'reencuentro.deviceId';
const CLAIMS_KEY = 'reencuentro.claimTokens';

/**
 * Identificador anónimo y estable del dispositivo.
 *
 * No identifica a una persona: sirve para que un mismo aparato no pueda inflar
 * la confianza de un reporte votándolo diez veces, y para asociar los reportes
 * creados desde aquí sin exigir que nadie cree una cuenta. Pedir registro antes
 * de poder reportar a un desaparecido cuesta reportes, y el sistema existe para
 * recibirlos.
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr';

  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID().replace(/-/g, '');
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export interface StoredClaim {
  claimToken: string;
  fullName: string;
  reportId: string;
  createdAt: string;
}

/**
 * Los claim tokens de los reportes creados desde este dispositivo.
 *
 * El servidor solo guarda su hash, así que esta copia local es la única forma
 * de volver al caso. Si se pierde, el reporte sigue existiendo y sigue entrando
 * al matching, pero esta persona deja de poder seguirlo: por eso la pantalla
 * de confirmación insiste en guardarlo o anotarlo.
 */
export function getStoredClaims(): StoredClaim[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(CLAIMS_KEY) ?? '[]') as StoredClaim[];
  } catch {
    return [];
  }
}

export function storeClaim(claim: StoredClaim): void {
  const claims = getStoredClaims();
  if (claims.some((c) => c.claimToken === claim.claimToken)) return;
  localStorage.setItem(CLAIMS_KEY, JSON.stringify([claim, ...claims]));
}
