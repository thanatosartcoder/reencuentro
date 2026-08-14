import type { NextConfig } from 'next';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4000';

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
    ];
  },
};

export default nextConfig;
