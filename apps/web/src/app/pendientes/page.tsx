'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  listPending,
  listPendingPhotos,
  onOutboxChange,
  remove,
  type OutboxEntry,
  type PendingPhoto,
} from '@/lib/outbox';
import { flushOutbox, flushPhotos } from '@/lib/sync';
import { useOnline } from '@/lib/realtime';
import { timeAgo } from '@/components/DecayMeter';
import { Notice } from '@/components/Form';

/**
 * Cola local.
 *
 * Existe para que la promesa de "se envía solo" sea verificable. Sin esta
 * pantalla, alguien que reportó sin señal no tiene forma de comprobar que su
 * reporte sigue ahí, y esa incertidumbre lleva a reportar de nuevo y a duplicar
 * el caso.
 */
export default function PendientesPage() {
  const online = useOnline();
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    setEntries(await listPending());
    setPhotos(await listPendingPhotos());
  };

  useEffect(() => {
    void refresh();
    return onOutboxChange(() => void refresh());
  }, []);

  const sendNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await flushOutbox();
      const uploaded = await flushPhotos();

      if (!result && uploaded === 0) {
        setMessage('No hay nada pendiente por enviar.');
      } else {
        const parts: string[] = [];
        if (result?.sent) parts.push(`${result.sent} enviados`);
        if (uploaded) parts.push(`${uploaded} fotos subidas`);
        if (result?.failed) parts.push(`${result.failed} sin enviar`);
        setMessage(parts.join(' · ') || 'Nada por enviar.');
      }
      await refresh();
    } catch {
      setMessage('No se pudo conectar. Lo pendiente sigue guardado en este teléfono.');
    } finally {
      setBusy(false);
    }
  };

  const total = entries.length + photos.length;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-[clamp(1.6rem,5.5vw,2.3rem)] font-bold leading-tight tracking-tight">
        Guardado en este teléfono
      </h1>
      <p className="mt-3 text-[17px] leading-snug text-ink-soft">
        {total === 0
          ? 'No queda nada por enviar. Todo lo que reportaste ya está en el sistema.'
          : 'Esto todavía no ha salido de tu teléfono. Se envía solo cuando haya señal, sin que tengas que abrir la aplicación.'}
      </p>

      {total > 0 && (
        <>
          <button
            type="button"
            onClick={sendNow}
            disabled={busy || !online}
            className="mt-6 flex min-h-[56px] w-full items-center justify-center bg-ink px-5 text-[17px] font-semibold text-paper disabled:opacity-40"
          >
            {busy ? 'Enviando…' : online ? 'Intentar enviar ahora' : 'Sin conexión'}
          </button>

          {message && <Notice tone="ok">{message}</Notice>}

          <ul className="mt-6">
            {entries.map((entry) => (
              <li key={entry.clientUuid} className="rule py-4">
                <p className="text-[17px] font-semibold leading-snug">{entry.label}</p>
                <p className="num mt-1 text-[13px] text-ink-faint">
                  guardado {timeAgo(new Date(entry.createdAt).toISOString())}
                  {entry.attempts > 0 && ` · ${entry.attempts} intento(s)`}
                </p>
                {entry.lastError && (
                  <p className="mt-1 text-[14px]" style={{ color: 'var(--color-naranja)' }}>
                    {entry.lastError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void remove(entry.clientUuid)}
                  className="mt-2 text-[15px] underline underline-offset-4"
                >
                  Descartar este reporte
                </button>
              </li>
            ))}

            {photos.map((photo) => (
              <li key={photo.clientUuid} className="rule py-4">
                <p className="text-[17px] font-semibold leading-snug">Foto adjunta</p>
                <p className="num mt-1 text-[13px] text-ink-faint">
                  guardada {timeAgo(new Date(photo.createdAt).toISOString())} ·{' '}
                  {Math.round(photo.blob.size / 1024)} KB
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      {total === 0 && (
        <Link
          href="/"
          className="mt-6 flex min-h-[56px] w-full items-center justify-center border-2 border-ink px-5 text-[17px] font-semibold"
        >
          Volver al inicio
        </Link>
      )}
    </div>
  );
}
