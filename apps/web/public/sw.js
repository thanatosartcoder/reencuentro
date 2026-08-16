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

// v2 retira las cachés de v1 al activarse. No es solo higiene: hasta v1 se
// guardaba en disco toda respuesta correcta de /api, incluidos el seguimiento de
// un caso (documento, teléfono, notas médicas) y la cola de validación. Subir la
// versión es lo que borra esa copia de los dispositivos que ya la tienen.
const VERSION = 'v2';
const SHELL_CACHE = `reencuentro-shell-${VERSION}`;
const DATA_CACHE = `reencuentro-data-${VERSION}`;
const TILE_CACHE = `reencuentro-tiles-${VERSION}`;

const SHELL_ASSETS = ['/', '/mapa', '/desaparecidos', '/offline'];

/**
 * Qué respuestas de la API se pueden guardar en disco.
 *
 * La regla no es "sin datos personales" sino algo más estrecho y más fácil de
 * verificar: **solo lo que ya es público y no hizo falta credencial para
 * pedirlo**. El listado de desaparecidos entra —es exactamente lo que alguien
 * necesita consultar sin señal, y cualquiera lo ve en la web—; el seguimiento de
 * un caso concreto no, aunque lo pida su propia familia.
 *
 * Importa porque esta caché sobrevive a cerrar la sesión y no caduca, y el
 * escenario para el que está pensada la aplicación es un albergue o una sala de
 * crisis donde el teléfono se presta.
 */
const API_CACHEABLE = [
  '/api/mapa/',
  '/api/vias/',
  '/api/sismos/',
  '/api/danos/',
  '/api/situacion',
  '/api/eventos',
  '/api/ingesta/estado',
  '/api/personas/desaparecidos',
  '/api/personas/avistamientos',
  '/api/personas/estadisticas',
];

/**
 * Lo que no se guarda nunca, aunque encaje con un prefijo de arriba.
 *
 * Se comprueba primero porque los prefijos se solapan: `/desaparecidos/:id/completo`
 * es la vista de operador con el documento y las notas médicas, y empieza igual
 * que el listado público.
 */
const API_NEVER_CACHE = [
  '/api/auth',
  '/api/matches',
  '/api/operadores',
  '/api/respaldos',
  '/api/admin/',
  '/api/export',
  '/api/notifications',
  '/api/estado-operativo',
  '/api/personas/mis-reportes',
];

function esCacheable(url, request) {
  if (!url.pathname.startsWith('/api/')) return false;

  // Señales de que la respuesta es de alguien y no de todos: si hubo credencial,
  // lo que vuelve está dirigido a quien lo pidió y no al dispositivo. Se miran
  // las tres formas aunque las rutas afectadas ya estén en la lista de abajo —
  // la lista hay que acordarse de actualizarla, y esto no.
  if (request.headers.has('Authorization')) return false;
  if (request.headers.has('X-Claim-Token')) return false;
  if (url.searchParams.has('claimToken')) return false;

  if (API_NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix))) return false;
  // La vista completa de un reporte es de operador aunque cuelgue de una ruta
  // pública.
  if (url.pathname.endsWith('/completo')) return false;

  return API_CACHEABLE.some((prefix) => url.pathname.startsWith(prefix));
}

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

  // Analítica: se deja pasar sin tocar la caché.
  //
  // El espacio que guarda este service worker es lo que le queda a alguien
  // cuando se le cae la señal, y tiene que alcanzar para reportar a una persona
  // desaparecida. La telemetría no compite por ese espacio, y un script de
  // medición servido desde una caché vieja no mide nada útil.
  if (url.pathname.startsWith('/_vercel/')) return;

  // Teselas del mapa: cache-first y de larga vida. La geografía no cambia, y
  // sin esto el mapa queda en blanco justo donde no hay señal.
  if (url.hostname.includes('openfreemap') || url.pathname.includes('/tiles/')) {
    event.respondWith(cacheFirst(request, TILE_CACHE));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    // Lo que no es cacheable va a la red sin pasar por aquí: ni se guarda ni se
    // sirve una copia vieja. Si no hay señal, falla — y eso es lo correcto para
    // el panel de validación, que no es una herramienta offline.
    if (esCacheable(url, request)) event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
  }
});

async function cacheFirst(request, cacheName) {
  // La búsqueda se acota a su propia caché. `caches.match` sin `cacheName`
  // recorre todas, así que una entrada guardada bajo otra política podría
  // servirse bajo esta.
  const cached = await caches.match(request, { cacheName });
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
    const cached = await caches.match(request, { cacheName });
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
