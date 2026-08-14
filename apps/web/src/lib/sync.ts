import { api, OfflineError } from './api';
import {
  cacheZones,
  listPending,
  listPendingPhotos,
  markFailed,
  remove,
  removePhoto,
  setMeta,
  getMeta,
} from './outbox';
import { storeClaim } from './device';

interface PushResult {
  clientUuid: string;
  status: 'created' | 'duplicate' | 'invalid' | 'error';
  id?: string;
  claimToken?: string | null;
  error?: string;
}

/**
 * Vacía la cola local contra el servidor.
 *
 * El lote se envía completo pero el servidor responde por operación, así que se
 * borra de la cola únicamente lo que quedó confirmado. Las operaciones
 * inválidas también se retiran: un payload mal formado no mejora reintentándolo
 * y solo bloquearía la cola detrás de él.
 */
export async function flushOutbox(): Promise<{ sent: number; failed: number } | null> {
  const pending = await listPending();
  if (!pending.length) return null;

  // Tandas de 50: en una red intermitente una petición grande tiene más
  // probabilidad de vencer por timeout que tres pequeñas.
  const batch = pending.slice(0, 50);

  let response: { results: PushResult[]; maxRevision: string };
  try {
    response = await api.post('/sync/push', {
      operations: batch.map((entry) => ({
        clientUuid: entry.clientUuid,
        type: entry.type,
        targetId: entry.targetId,
        payload: entry.payload,
      })),
    });
  } catch (error) {
    if (error instanceof OfflineError) return null;
    throw error;
  }

  let sent = 0;
  let failed = 0;

  for (const result of response.results) {
    if (result.status === 'created' || result.status === 'duplicate') {
      // El claim token solo existe en esta respuesta: el servidor guarda su
      // hash y no puede volver a emitirlo. Si no se captura aquí, quien reportó
      // sin señal pierde para siempre la forma de seguir su caso.
      if (result.claimToken) {
        const entry = batch.find((e) => e.clientUuid === result.clientUuid);
        storeClaim({
          claimToken: result.claimToken,
          fullName: String(entry?.payload.fullName ?? entry?.label ?? 'Reporte'),
          reportId: result.id ?? result.clientUuid,
          createdAt: new Date().toISOString(),
        });
      }
      await remove(result.clientUuid);
      sent++;
    } else if (result.status === 'invalid') {
      await remove(result.clientUuid);
      failed++;
    } else {
      await markFailed(result.clientUuid, result.error ?? 'Error desconocido');
      failed++;
    }
  }

  return { sent, failed };
}

/**
 * Sube las fotos encoladas.
 *
 * Se hace después de vaciar el outbox de reportes: la foto necesita que su
 * reporte exista en el servidor. Como el id del reporte es el UUID que generó
 * el cliente, la foto ya sabe a qué caso pertenece desde antes de que hubiera
 * conexión, y no hace falta esperar a que el servidor asigne una identidad.
 */
export async function flushPhotos(): Promise<number> {
  const photos = await listPendingPhotos();
  let uploaded = 0;

  for (const photo of photos) {
    const form = new FormData();
    form.append('file', photo.blob, `${photo.clientUuid}.jpg`);
    form.append('clientUuid', photo.clientUuid);
    form.append('ownerType', photo.ownerType);
    form.append('ownerId', photo.ownerId);

    try {
      const response = await fetch('/api/personas/fotos', { method: 'POST', body: form });
      if (response.ok) {
        await removePhoto(photo.clientUuid);
        uploaded++;
      } else if (response.status >= 400 && response.status < 500) {
        // Un rechazo del servidor no se arregla reintentando y bloquearía la
        // cola detrás de él.
        await removePhoto(photo.clientUuid);
      }
    } catch {
      // Sin red: se queda para el siguiente intento.
      break;
    }
  }

  return uploaded;
}

/**
 * Descarga los cambios desde la última revisión conocida.
 *
 * El cursor es la revisión global del servidor, no una marca de tiempo: da un
 * orden total y avanza también en las ediciones, así que ningún cambio se
 * pierde por un empate de reloj.
 */
export async function pullZones(bbox?: string): Promise<number> {
  const since = (await getMeta('zonesRevision')) ?? '0';

  try {
    const response = await api.get<{
      zones: { id: string; revision: string }[];
      maxRevision: string;
    }>(`/sync/pull?sinceRevision=${since}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ''}`);

    if (response.zones.length) {
      await cacheZones(response.zones);
      await setMeta('zonesRevision', response.maxRevision);
    }
    return response.zones.length;
  } catch (error) {
    if (error instanceof OfflineError) return 0;
    throw error;
  }
}

/**
 * Arranca la sincronización de fondo.
 *
 * Se dispara al recuperar la conexión y al volver la pestaña a primer plano,
 * además de un intervalo largo de respaldo. En un navegador no hay equivalente
 * real a WorkManager o BGTaskScheduler, así que la app móvil es la que puede
 * garantizar el envío con la pantalla apagada; aquí se hace lo posible mientras
 * la pestaña viva.
 */
export function startBackgroundSync(onSync?: (result: { sent: number; failed: number }) => void) {
  if (typeof window === 'undefined') return () => {};

  let running = false;

  const run = async () => {
    if (running || !navigator.onLine) return;
    running = true;
    try {
      const result = await flushOutbox();
      // Las fotos van después de los reportes: necesitan que su caso ya exista.
      await flushPhotos();
      if (result && onSync) onSync(result);
    } catch {
      // Un fallo de sincronización no debe romper la interfaz: la cola sigue
      // intacta y el siguiente intento la retoma.
    } finally {
      running = false;
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') void run();
  };

  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onVisible);
  const interval = window.setInterval(run, 60_000);
  void run();

  return () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(interval);
  };
}
