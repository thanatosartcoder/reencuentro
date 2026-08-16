import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type OperationType = 'MISSING_REPORT' | 'SIGHTING' | 'ZONE_REPORT' | 'ZONE_VOTE';

export interface OutboxEntry {
  clientUuid: string;
  type: OperationType;
  targetId?: string;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  lastError?: string;
  /** Resumen legible para la pantalla de "pendientes de enviar". */
  label: string;
}

export interface CachedZone {
  id: string;
  revision: string;
  data: unknown;
}

export interface PendingPhoto {
  clientUuid: string;
  ownerType: 'MISSING_REPORT' | 'SIGHTING_REPORT';
  ownerId: string;
  blob: Blob;
  /**
   * Credencial del reporte al que pertenece. El servidor la exige para adjuntar.
   *
   * Opcional porque una foto encolada sin señal se guarda antes de que el
   * reporte exista en el servidor, y hasta entonces el token no ha sido emitido.
   * Al vaciar la cola se resuelve desde los claims guardados: los reportes se
   * envían antes que las fotos, así que para cuando le toca a la foto el token
   * ya está en este dispositivo.
   */
  claimToken?: string;
  createdAt: number;
}

interface ReencuentroDB extends DBSchema {
  outbox: {
    key: string;
    value: OutboxEntry;
    indexes: { 'by-createdAt': number };
  };
  photos: {
    key: string;
    value: PendingPhoto;
  };
  zones: {
    key: string;
    value: CachedZone;
  };
  meta: {
    key: string;
    value: { key: string; value: string };
  };
}

let dbPromise: Promise<IDBPDatabase<ReencuentroDB>> | null = null;

function getDb(): Promise<IDBPDatabase<ReencuentroDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ReencuentroDB>('reencuentro', 1, {
      upgrade(db) {
        const outbox = db.createObjectStore('outbox', { keyPath: 'clientUuid' });
        outbox.createIndex('by-createdAt', 'createdAt');
        db.createObjectStore('photos', { keyPath: 'clientUuid' });
        db.createObjectStore('zones', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
  }
  return dbPromise;
}

/**
 * Patrón outbox.
 *
 * Toda acción del usuario se escribe primero aquí y se envía después, nunca al
 * revés. Esto no es un plan de contingencia para cuando se cae la red: es el
 * flujo normal. La persona ve su reporte guardado al instante, con o sin señal,
 * y el envío ocurre cuando puede.
 *
 * El UUID lo genera el cliente antes de tener conexión, así que el reporte
 * tiene identidad desde el primer momento y el servidor puede deduplicar los
 * reintentos sin ambigüedad.
 */
export async function enqueue(
  entry: Omit<OutboxEntry, 'createdAt' | 'attempts'>,
): Promise<void> {
  const db = await getDb();
  await db.put('outbox', { ...entry, createdAt: Date.now(), attempts: 0 });
  notifyChange();
}

export async function listPending(): Promise<OutboxEntry[]> {
  const db = await getDb();
  return db.getAllFromIndex('outbox', 'by-createdAt');
}

export async function countPending(): Promise<number> {
  const db = await getDb();
  return db.count('outbox');
}

export async function remove(clientUuid: string): Promise<void> {
  const db = await getDb();
  await db.delete('outbox', clientUuid);
  notifyChange();
}

export async function markFailed(clientUuid: string, error: string): Promise<void> {
  const db = await getDb();
  const entry = await db.get('outbox', clientUuid);
  if (!entry) return;
  await db.put('outbox', { ...entry, attempts: entry.attempts + 1, lastError: error });
  notifyChange();
}

// --- Fotos pendientes de subir ---

/**
 * Las fotos se encolan aparte de los reportes.
 *
 * Un reporte de texto pesa unos pocos KB y tiene que llegar cuanto antes; una
 * foto pesa cientos y puede reintentarse por su cuenta sin retrasar el registro
 * del caso. Separarlas evita que la foto sea la razón por la que una
 * desaparición no queda registrada.
 *
 * El blob se guarda ya comprimido: en IndexedDB caben, pero el almacenamiento
 * de un teléfono en campo es finito y este es el recurso que se agota primero.
 */
export async function enqueuePhoto(photo: Omit<PendingPhoto, 'createdAt'>): Promise<void> {
  const db = await getDb();
  await db.put('photos', { ...photo, createdAt: Date.now() });
  notifyChange();
}

export async function listPendingPhotos(): Promise<PendingPhoto[]> {
  const db = await getDb();
  return db.getAll('photos');
}

export async function removePhoto(clientUuid: string): Promise<void> {
  const db = await getDb();
  await db.delete('photos', clientUuid);
  notifyChange();
}

// --- Caché del mapa ---

/**
 * Los reportes de zona descargados se conservan localmente para que el mapa
 * siga siendo legible sin conexión. Es el caso de uso central en Chocó, donde
 * hay zonas sin cobertura y es justo donde más se necesita saber qué vía está
 * cortada.
 */
export async function cacheZones(zones: { id: string; revision: string }[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('zones', 'readwrite');
  await Promise.all(
    zones.map((zone) => tx.store.put({ id: zone.id, revision: zone.revision, data: zone })),
  );
  await tx.done;
}

export async function getCachedZones(): Promise<unknown[]> {
  const db = await getDb();
  const rows = await db.getAll('zones');
  return rows.map((r) => r.data);
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.get('meta', key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key, value });
}

// --- Notificación de cambios a la interfaz ---

const CHANGE_EVENT = 'reencuentro:outbox-changed';

function notifyChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }
}

export function onOutboxChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
