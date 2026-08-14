/**
 * Service worker.
 *
 * Dos estrategias, elegidas por lo que cuesta equivocarse en cada caso:
 *
 * - App shell (navegación, JS, CSS): cache-first. Si el HTML no carga, no hay
 *   nada. Vale más servir una versión de ayer que una pantalla en blanco.
 *
 * - Datos de la API: network-first con respaldo en caché. Un mapa de hace seis
 *   horas es peligroso si se presenta como actual, así que siempre se intenta
 *   la red primero; la copia guardada es el último recurso y la interfaz avisa
 *   de su antigüedad.
 *
 * Las escrituras nunca pasan por aquí: van al outbox en IndexedDB, que
 * sobrevive al cierre de la pestaña y a un reinicio del teléfono.
 */

const VERSION = 'v1';
const SHELL_CACHE = `reencuentro-shell-${VERSION}`;
const DATA_CACHE = `reencuentro-data-${VERSION}`;
const TILE_CACHE = `reencuentro-tiles-${VERSION}`;

const SHELL_ASSETS = ['/', '/mapa', '/desaparecidos', '/offline'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // addAll falla en bloque si un solo recurso falla; se agregan de a uno
      // para que la instalación no se caiga entera por un 404.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, DATA_CACHE, TILE_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Teselas del mapa: cache-first y de larga vida. La geografía no cambia, y
  // sin esto el mapa queda en blanco justo donde no hay señal.
  if (url.hostname.includes('openfreemap') || url.pathname.includes('/tiles/')) {
    event.respondWith(cacheFirst(request, TILE_CACHE));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
  }
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Sin conexión' });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) {
      // Se marca la respuesta como servida desde caché para que la interfaz
      // pueda advertir que el dato puede estar vencido, en lugar de mostrarlo
      // como si acabara de llegar.
      const headers = new Headers(cached.headers);
      headers.set('X-Reencuentro-Cache', 'hit');
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }

    if (request.mode === 'navigate') {
      const offline = await caches.match('/offline');
      if (offline) return offline;
    }

    return new Response(JSON.stringify({ message: 'Sin conexión y sin copia local' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// La app avisa al service worker cuando hay algo en el outbox, para que el
// navegador reintente el envío en segundo plano si soporta Background Sync.
self.addEventListener('sync', (event) => {
  if (event.tag === 'reencuentro-outbox') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        for (const client of clients) client.postMessage({ type: 'FLUSH_OUTBOX' });
      }),
    );
  }
});
