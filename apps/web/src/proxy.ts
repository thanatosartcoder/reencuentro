import { NextResponse, type NextRequest } from 'next/server';

/**
 * Content-Security-Policy estricta, solo para el panel de validación.
 *
 * La política general vive en `next.config.ts` y lleva `script-src
 * 'unsafe-inline'`, así que no detiene un XSS. Quitarlo en toda la aplicación
 * exige un nonce por petición, y un nonce por petición obliga a renderizar cada
 * página en cada visita — justo lo que dejaría de sostener el modo sin conexión,
 * porque el service worker guarda las páginas públicas prerenderizadas para
 * cuando no hay señal.
 *
 * No hace falta elegir. Son pantallas distintas y corren riesgos distintos:
 *
 * - Las públicas (portada, mapa, desaparecidos) no tienen sesión ni datos
 *   personales en el navegador. Lo que se juegan es funcionar sin cobertura.
 * - El panel tiene el token del operador en `localStorage` y, en pantalla, el
 *   documento y las notas médicas de personas reales. Y nadie lo abre sin
 *   conexión.
 *
 * Así que el nonce se aplica donde el XSS cuesta caro, y el prerenderizado se
 * conserva donde cuesta caro perderlo.
 */

/** Rutas que reciben la política estricta. Ver `config.matcher` abajo. */
const RUTAS_ESTRICTAS = ['/panel'];

function politicaEstricta(nonce: string, esDesarrollo: boolean): string {
  // `strict-dynamic` hace que los scripts cargados por un script con nonce
  // hereden la confianza. Sin él habría que enumerar cada fragmento que Next
  // inyecta, y esa lista se rompe en cada actualización del framework.
  //
  // En desarrollo React usa `eval` para reconstruir las trazas de error en el
  // navegador. En producción no lo necesita, y ahí no se concede.
  const script = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(esDesarrollo ? ["'unsafe-eval'"] : []),
  ].join(' ');

  return [
    "default-src 'self'",
    `script-src ${script}`,
    // Los estilos siguen admitiendo `unsafe-inline`: Next y Tailwind inyectan
    // CSS crítico en línea y bloquearlo dejaría el panel sin maquetar. La
    // exfiltración por CSS existe, pero es un vector mucho más estrecho que la
    // ejecución de scripts, y aquí el precio de equivocarse es que el personal
    // de validación se quede sin herramienta en mitad de una emergencia.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // El panel habla con la API por el mismo origen, vía el rewrite de
    // `next.config.ts`. No abre WebSocket ni carga teselas.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self'",
  ].join('; ');
}

export function proxy(request: NextRequest): NextResponse {
  if (!RUTAS_ESTRICTAS.some((ruta) => request.nextUrl.pathname.startsWith(ruta))) {
    return NextResponse.next();
  }

  // Aleatorio y distinto en cada visita: un nonce predecible no protege de nada.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const politica = politicaEstricta(nonce, process.env.NODE_ENV === 'development');

  // La cabecera va también en la *petición* porque es de ahí de donde Next lee
  // el nonce para estamparlo en los scripts que inyecta. Solo en la respuesta,
  // el navegador bloquearía los propios scripts del framework.
  const cabeceras = new Headers(request.headers);
  cabeceras.set('x-nonce', nonce);
  cabeceras.set('Content-Security-Policy', politica);

  const respuesta = NextResponse.next({ request: { headers: cabeceras } });
  respuesta.headers.set('Content-Security-Policy', politica);
  return respuesta;
}

export const config = {
  matcher: ['/panel/:path*'],
};
