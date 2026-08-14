'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { countPending, onOutboxChange } from '@/lib/outbox';
import { startBackgroundSync } from '@/lib/sync';
import { useOnline } from '@/lib/realtime';

/**
 * Estado de conexión y cola pendiente.
 *
 * Solo aparece cuando hay algo que decir: sin conexión o con reportes sin
 * enviar. Una barra permanente de "todo bien" gasta espacio en pantalla y deja
 * de leerse, con lo cual tampoco se lee cuando sí importa.
 *
 * El texto nombra el estado en términos de lo que la persona hizo ("2 reportes
 * guardados en este teléfono"), no del mecanismo ("cola de sincronización").
 */
export function SyncBar() {
  const online = useOnline();
  const [pending, setPending] = useState(0);
  const [justSent, setJustSent] = useState(0);

  useEffect(() => {
    const refresh = () => void countPending().then(setPending);
    refresh();

    const stopWatching = onOutboxChange(refresh);
    const stopSync = startBackgroundSync((result) => {
      if (result.sent > 0) {
        setJustSent(result.sent);
        window.setTimeout(() => setJustSent(0), 6_000);
      }
      refresh();
    });

    // El service worker pide vaciar la cola cuando el navegador le concede
    // una ventana de Background Sync.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'FLUSH_OUTBOX') refresh();
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);

    return () => {
      stopWatching();
      stopSync();
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, []);

  if (justSent > 0) {
    return (
      <Banner background="var(--color-via)">
        Se enviaron {justSent} {justSent === 1 ? 'reporte' : 'reportes'} que estaban guardados
        en este teléfono.
      </Banner>
    );
  }

  if (!online) {
    return (
      <Banner background="var(--color-naranja)">
        Sin conexión. Puedes seguir reportando: lo que guardes se envía solo cuando vuelva la
        señal.
        {pending > 0 && (
          <>
            {' '}
            <Link href="/pendientes" className="underline underline-offset-2">
              {pending} {pending === 1 ? 'reporte guardado' : 'reportes guardados'}
            </Link>
          </>
        )}
      </Banner>
    );
  }

  if (pending > 0) {
    return (
      <Banner background="var(--color-amarilla)" foreground="var(--color-ink)">
        Enviando {pending} {pending === 1 ? 'reporte guardado' : 'reportes guardados'}…{' '}
        <Link href="/pendientes" className="underline underline-offset-2">
          Ver cuáles
        </Link>
      </Banner>
    );
  }

  return null;
}

function Banner({
  children,
  background,
  foreground = 'var(--color-paper)',
}: {
  children: React.ReactNode;
  background: string;
  foreground?: string;
}) {
  return (
    <div
      role="status"
      className="px-4 py-2.5 text-[15px] leading-snug"
      style={{ background, color: foreground }}
    >
      <div className="mx-auto max-w-5xl">{children}</div>
    </div>
  );
}
