const DEVICE_KEY = 'reencuentro.deviceId';
const DEVICE_TOKEN_KEY = 'reencuentro.deviceToken';
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
  /**
   * Qué se reportó.
   *
   * Un avistamiento también recibe claim token —lo necesita para adjuntar su
   * foto— pero no se sigue desde "Mis reportes": esa pantalla consulta el
   * seguimiento de una desaparición, y pedirlo con el token de un avistamiento
   * responde 401. Se distingue aquí en lugar de descubrirlo por el error.
   *
   * Opcional por los claims que ya estén guardados en dispositivos que
   * actualicen: sin el campo, se asumen desapariciones, que es lo único que se
   * guardaba antes.
   */
  kind?: 'MISSING' | 'SIGHTING';
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

/**
 * Credencial de dispositivo firmada por el servidor, para votar en el mapa.
 *
 * El `deviceId` de arriba lo genera este teléfono, así que el servidor no puede
 * distinguirlo de uno inventado: bastaba con mandar identificadores distintos
 * para votar muchas veces y enterrar del mapa una vía cortada. Esta credencial
 * la emite el servidor y va firmada.
 *
 * Se pide una sola vez y se guarda. Si no hay señal cuando toca pedirla, el voto
 * sale igual pero sin verificar: contará como señal de la comunidad y no bajará
 * la confianza. Es mejor eso que perder el voto de quien está en el sitio.
 */
export async function getDeviceToken(): Promise<string | undefined> {
  if (typeof window === 'undefined') return undefined;

  const guardado = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (guardado) return guardado;

  try {
    const respuesta = await fetch('/api/mapa/dispositivos', { method: 'POST' });
    if (!respuesta.ok) return undefined;
    const { deviceToken } = (await respuesta.json()) as { deviceToken?: string };
    if (deviceToken) localStorage.setItem(DEVICE_TOKEN_KEY, deviceToken);
    return deviceToken;
  } catch {
    // Sin conexión. El voto se encola igual y viajará sin credencial.
    return undefined;
  }
}
