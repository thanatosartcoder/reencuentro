import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Credencial anónima de dispositivo.
 *
 * El mapa se alimenta de votos: "esta vía sigue cortada" / "ya está despejada".
 * Para que un mismo teléfono no vote diez veces, el sistema deduplicaba por un
 * `deviceId` que **enviaba el propio cliente**. Es decir, la defensa contra
 * votar muchas veces consistía en pedirle al votante que dijera quién es y
 * creerle. Inventarse un identificador distinto en cada petición bastaba para
 * enterrar del mapa una vía cortada.
 *
 * Aquí el identificador lo emite el servidor y va firmado. No identifica a
 * nadie —es un número al azar, sin relación con la persona ni con el aparato—
 * pero no se puede fabricar sin la clave del servidor.
 *
 * ## Lo que esto no resuelve
 *
 * Conviene decirlo en el sitio donde alguien vendrá a confiar en ello: **un
 * atacante puede pedir muchos tokens**. La firma no impide fabricar identidades,
 * impide fabricarlas *gratis y sin pasar por el servidor*. Lo que cierra el
 * hueco es la combinación de tres cosas:
 *
 *   1. cada token exige una petición a `/dispositivos`, que va con límite por IP;
 *   2. esa petición queda registrada, así que una ráfaga se ve;
 *   3. un voto sin token firmado deja de contar para bajar la confianza.
 *
 * Un ataque sigue siendo posible con volumen y con IPs distintas. Deja de serlo
 * con un bucle de tres líneas desde una consola.
 */

/** Longitud del identificador. 16 bytes al azar: irrepetible en la práctica. */
const ID_BYTES = 16;

/** Versión del formato, por delante. Permite rotar la clave sin adivinar. */
const VERSION = 'd1';

function claveDeFirma(): Buffer {
  const raw = process.env.DEVICE_TOKEN_SECRET?.trim() || process.env.JWT_SECRET?.trim();
  if (!raw) {
    // No debería ocurrir: `assertJwtSecret` corre antes de escuchar. Se
    // comprueba igual porque firmar con una cadena vacía no falla, solo produce
    // firmas que cualquiera puede reproducir.
    throw new Error('No hay clave para firmar tokens de dispositivo.');
  }
  return Buffer.from(raw, 'utf8');
}

function firmar(id: string): string {
  return createHmac('sha256', claveDeFirma()).update(`${VERSION}:${id}`).digest('base64url');
}

/** Emite una credencial nueva. El identificador es aleatorio y no dice nada de nadie. */
export function emitirTokenDeDispositivo(): { deviceId: string; deviceToken: string } {
  const deviceId = randomBytes(ID_BYTES).toString('hex');
  return { deviceId, deviceToken: `${VERSION}.${deviceId}.${firmar(deviceId)}` };
}

/**
 * Devuelve el identificador si el token lo emitió este servidor, o null.
 *
 * Nunca lanza: un token ausente, caducado en formato o manipulado no es un error
 * del que reporta, es simplemente un voto que no cuenta. Tratarlo como
 * excepción convertiría un cliente viejo en un fallo visible.
 */
export function verificarTokenDeDispositivo(token: string | undefined): string | null {
  if (!token) return null;

  const partes = token.split('.');
  if (partes.length !== 3) return null;

  const [version, deviceId, firma] = partes;
  if (version !== VERSION || !/^[0-9a-f]{32}$/.test(deviceId)) return null;

  const esperada = Buffer.from(firmar(deviceId));
  const recibida = Buffer.from(firma);

  // Tiempo constante, como el resto de comparaciones de credenciales del
  // proyecto: la latencia no debe decir cuántos caracteres se acertaron.
  if (esperada.length !== recibida.length) return null;
  return timingSafeEqual(esperada, recibida) ? deviceId : null;
}
