import type { NextConfig } from 'next';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4000';
const mapStyle =
  process.env.NEXT_PUBLIC_MAP_STYLE ?? 'https://tiles.openfreemap.org/styles/liberty';

/** Origen de una URL, o cadena vacía si no se puede leer (no rompe el build). */
function origenDe(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * El canal en vivo no pasa por el rewrite: `socket.io` se conecta directamente
 * al origen de la API, así que hay que permitir también su forma `ws`.
 */
function origenWebSocket(url: string): string {
  const origen = origenDe(url);
  return origen ? origen.replace(/^http/, 'ws') : '';
}

/**
 * Content-Security-Policy.
 *
 * Se construye aquí y no en `vercel.json` porque depende de valores
 * configurables —el origen de la API y el de las teselas— y un fichero estático
 * no puede leerlos. Quien autoaloje las teselas cambia `NEXT_PUBLIC_MAP_STYLE` y
 * la política le sigue sola, en vez de tener que acordarse de un segundo sitio.
 *
 * ## Qué protege y qué no
 *
 * `script-src` lleva `'unsafe-inline'`, y conviene decirlo claro: **esta
 * política no detiene un XSS**. Next inyecta scripts en línea para la
 * hidratación, y la alternativa —un nonce por petición desde el middleware—
 * obliga a renderizar en cada visita las páginas que hoy salen prerenderizadas.
 * En una aplicación pensada para redes malas, y cuyo service worker guarda esas
 * páginas para funcionar sin señal, ese coste es peor que lo que se gana.
 *
 * Lo que sí cierra son vías concretas que no dependen de scripts en línea:
 * `object-src 'none'` (plugins), `base-uri 'self'` (reescribir la base de todas
 * las URL relativas), `form-action 'self'` (mandar un formulario a un servidor
 * ajeno), `frame-ancestors 'none'` (clickjacking) y, sobre todo, un
 * `connect-src` cerrado: aunque alguien lograra ejecutar código, no tendría a
 * dónde enviarse los datos.
 */
function contentSecurityPolicy(): string {
  const api = origenDe(apiOrigin);
  const ws = origenWebSocket(apiOrigin);
  const teselas = origenDe(mapStyle);

  const conectar = ["'self'", api, ws, teselas].filter(Boolean);
  const imagenes = ["'self'", 'data:', 'blob:', teselas].filter(Boolean);

  const directivas: Record<string, string[]> = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'manifest-src': ["'self'"],
    // Ver la nota de arriba sobre `'unsafe-inline'`.
    'script-src': ["'self'", "'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'font-src': ["'self'", 'data:'],
    // MapLibre crea sus trabajadores desde un blob para descodificar teselas
    // fuera del hilo principal. Sin `blob:`, el mapa no pinta nada.
    'worker-src': ["'self'", 'blob:'],
    'img-src': imagenes,
    'connect-src': conectar,
  };

  const politica = Object.entries(directivas)
    .map(([nombre, valores]) => `${nombre} ${valores.join(' ')}`)
    .join('; ');

  // Se ata al esquema real de la API y no a NODE_ENV: una compilación de
  // producción levantada en local apunta a `http://localhost:4000`, y forzar la
  // subida a https ahí deja la aplicación sin API sin decir por qué.
  return api.startsWith('https://') ? `${politica}; upgrade-insecure-requests` : politica;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,

  async rewrites() {
    // La API se sirve bajo el mismo origen que la app. Esto evita el preflight
    // CORS en cada peticion (una ida y vuelta extra que se nota en 2G) y hace
    // que el service worker pueda cachear e interceptar las respuestas de la
    // API igual que cualquier otro recurso.
    return [
      { source: '/api/:path*', destination: `${apiOrigin}/api/:path*` },
      { source: '/media/:path*', destination: `${apiOrigin}/api/media/:path*` },
    ];
  },

  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          // El service worker nunca se cachea: si queda uno viejo pegado, el
          // usuario se queda con una version de la app que no puede actualizar.
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        // El resto de cabeceras de seguridad viven en `vercel.json`, que es
        // estatico. Esta va aqui porque depende de los origenes configurables.
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: contentSecurityPolicy() }],
      },
    ];
  },
};

export default nextConfig;
