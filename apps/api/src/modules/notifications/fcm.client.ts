import { createSign } from 'node:crypto';

/**
 * Cliente de Firebase Cloud Messaging, API HTTP v1.
 *
 * Sustituye a la API legacy (`/fcm/send` con `Authorization: key=...`), que
 * Google retiró. Mientras se apuntaba ahí, **ningún push salía**: el servidor
 * respondía 4xx y el aviso moría. El fallo pasaba desapercibido porque el canal
 * WebSocket sí funciona — y eso es justo lo peligroso, porque el push existe
 * para quien *no* tiene la pantalla abierta esperando.
 *
 * ## Por qué no hay dependencia nueva
 *
 * La v1 se autentica con OAuth2: se firma un JWT con la clave privada de una
 * cuenta de servicio y se cambia por un token de acceso. `firebase-admin` hace
 * eso y arrastra decenas de paquetes; aquí son treinta líneas con el `crypto`
 * de Node. En una aplicación que hay que poder auditar y desplegar en una
 * emergencia, cada dependencia es superficie que alguien tiene que revisar.
 *
 * ## Diferencia que importa respecto a la API vieja
 *
 * La legacy aceptaba `registration_ids` y enviaba a muchos dispositivos de una
 * vez. La v1 es **un mensaje por token**, así que el envío a varios dispositivos
 * es un bucle. A cambio distingue con claridad el token muerto (`UNREGISTERED`,
 * `INVALID_ARGUMENT`) del fallo transitorio, que es lo que permite dejar de
 * reintentar contra un teléfono que se desinstaló la aplicación.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** Margen antes de que caduque el token de acceso, para no usarlo justo al filo. */
const RENOVAR_ANTES_MS = 60_000;

export interface CuentaDeServicio {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** El envío no se puede completar nunca con este token: no tiene sentido reintentar. */
export class TokenMuerto extends Error {}

/**
 * Lee la cuenta de servicio del entorno.
 *
 * Se admite base64 además del JSON en crudo porque la clave privada lleva saltos
 * de línea, y pegarla tal cual en el panel de una plataforma es la forma más
 * común de que llegue rota. Devuelve null si no hay nada configurado — el push
 * es opcional y su ausencia no debe impedir arrancar.
 */
export function leerCuentaDeServicio(raw: string | undefined): CuentaDeServicio | null {
  const valor = raw?.trim();
  if (!valor) return null;

  const texto = valor.startsWith('{') ? valor : Buffer.from(valor, 'base64').toString('utf8');

  let json: Partial<CuentaDeServicio>;
  try {
    json = JSON.parse(texto) as Partial<CuentaDeServicio>;
  } catch {
    throw new Error(
      'FCM_SERVICE_ACCOUNT no es un JSON válido ni un base64 que lo contenga.',
    );
  }

  if (!json.project_id || !json.client_email || !json.private_key) {
    throw new Error(
      'FCM_SERVICE_ACCOUNT necesita project_id, client_email y private_key.',
    );
  }

  return {
    project_id: json.project_id,
    client_email: json.client_email,
    // Una clave pegada en una variable de entorno suele llegar con los saltos
    // de línea escapados. Sin esto, la firma falla con un error de OpenSSL que
    // no dice nada sobre la causa real.
    private_key: json.private_key.replace(/\\n/g, '\n'),
  };
}

const base64url = (valor: object) => Buffer.from(JSON.stringify(valor)).toString('base64url');

/**
 * Construye el JWT que se cambia por un token de acceso.
 *
 * Se expone para poder verificarlo en pruebas sin hablar con Google: lo que se
 * puede comprobar aquí es que las reclamaciones y la firma son correctas.
 */
export function construirAssertion(cuenta: CuentaDeServicio, ahoraSegundos: number): string {
  const cabecera = base64url({ alg: 'RS256', typ: 'JWT' });
  const claims = base64url({
    iss: cuenta.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: ahoraSegundos,
    exp: ahoraSegundos + 3600,
  });

  const sinFirmar = `${cabecera}.${claims}`;
  const firma = createSign('RSA-SHA256').update(sinFirmar).sign(cuenta.private_key, 'base64url');
  return `${sinFirmar}.${firma}`;
}

export class FcmClient {
  private acceso: { token: string; expiraEn: number } | null = null;

  constructor(private readonly cuenta: CuentaDeServicio) {}

  /**
   * Token de acceso, reutilizado hasta poco antes de caducar.
   *
   * Sin caché se pediría uno por cada notificación: una firma RSA y una ida y
   * vuelta a Google por cada aviso a una familia.
   */
  private async tokenDeAcceso(): Promise<string> {
    if (this.acceso && Date.now() < this.acceso.expiraEn - RENOVAR_ANTES_MS) {
      return this.acceso.token;
    }

    const respuesta = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: construirAssertion(this.cuenta, Math.floor(Date.now() / 1000)),
      }),
    });

    if (!respuesta.ok) {
      throw new Error(
        `No se pudo obtener el token de acceso de Google (${respuesta.status}): ${await respuesta.text()}`,
      );
    }

    const datos = (await respuesta.json()) as { access_token: string; expires_in: number };
    this.acceso = {
      token: datos.access_token,
      expiraEn: Date.now() + datos.expires_in * 1000,
    };
    return datos.access_token;
  }

  /**
   * Envía a un dispositivo.
   *
   * Lanza `TokenMuerto` cuando el destinatario ya no existe —desinstaló la
   * aplicación, cambió de teléfono— para que quien llama deje de intentarlo y
   * limpie el registro, en lugar de reintentar contra la nada durante horas.
   */
  async enviar(input: {
    token: string;
    titulo: string;
    cuerpo: string;
    datos?: Record<string, string>;
  }): Promise<void> {
    const acceso = await this.tokenDeAcceso();
    const url = `https://fcm.googleapis.com/v1/projects/${this.cuenta.project_id}/messages:send`;

    const respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${acceso}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: input.token,
          notification: { title: input.titulo, body: input.cuerpo },
          // FCM v1 exige que todos los valores de `data` sean cadenas. Un número
          // ahí dentro hace que rechace el mensaje entero con un 400 que no
          // explica cuál era el campo.
          data: Object.fromEntries(
            Object.entries(input.datos ?? {}).map(([k, v]) => [k, String(v)]),
          ),
          android: { priority: 'high' },
          apns: { headers: { 'apns-priority': '10' } },
        },
      }),
    });

    if (respuesta.ok) return;

    const texto = await respuesta.text();

    // 404 y UNREGISTERED significan que el token ya no corresponde a ninguna
    // instalación. INVALID_ARGUMENT sobre el token, lo mismo: está malformado.
    const muerto =
      respuesta.status === 404 ||
      /UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/i.test(texto);

    const detalle = `FCM respondió ${respuesta.status}: ${texto.slice(0, 300)}`;
    if (muerto) throw new TokenMuerto(detalle);
    throw new Error(detalle);
  }
}
