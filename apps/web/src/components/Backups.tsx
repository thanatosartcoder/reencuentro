'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { timeAgo } from '@/components/DecayMeter';
import { Notice } from '@/components/Form';

/**
 * Estado de las copias de seguridad.
 *
 * El valor de esto no es el botón: es la fecha. Una copia que lleva días
 * fallando en silencio es peor que no tener copias, porque se cree que están —
 * y eso solo se descubre el día que hacen falta, que es el peor día posible
 * para descubrirlo.
 *
 * Por eso lo primero que se ve es **cuándo fue la última**, y por eso avisa en
 * cuanto pasa de día y medio: la copia corre cada noche, así que más de eso
 * significa que algo se rompió.
 */

interface Estado {
  total: number;
  ultima: {
    clave: string;
    bytes: number;
    fecha: string;
    horasDesde: number;
  } | null;
  copias: { clave: string; bytes: number; fecha: string }[];
}

/** Margen sobre las 24 h del ciclo, para no alarmar por un retraso normal. */
const HORAS_PARA_ALARMA = 36;

export function Backups({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [busy, setBusy] = useState(false);
  const [mensaje, setMensaje] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(
    null,
  );

  const auth = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      setEstado(await api.get<Estado>('/respaldos/estado', { headers: auth }));
    } catch (err) {
      setMensaje({
        tone: 'error',
        text:
          err instanceof ApiError && err.status === 403
            ? 'Necesitas rol de coordinador para ver las copias.'
            : 'No se pudo consultar el estado de las copias.',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const ejecutar = async () => {
    setBusy(true);
    setMensaje(null);
    try {
      const r = await api.post<{ bytes: number; tablas: number; segundos: number }>(
        '/respaldos/ejecutar',
        {},
        { headers: auth },
      );
      setMensaje({
        tone: 'ok',
        text: `Copia hecha: ${formatBytes(r.bytes)}, ${r.tablas} tablas, ${r.segundos} s.`,
      });
      await load();
    } catch (err) {
      setMensaje({
        tone: 'error',
        text: err instanceof ApiError ? err.message : 'La copia falló.',
      });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 w-full border-2 border-rule px-4 py-3 text-left hover:border-ink"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[16px] font-semibold">Copias de seguridad</span>
          <span className="text-[13px] text-ink-faint">ver estado →</span>
        </span>
      </button>
    );
  }

  const vieja =
    estado?.ultima != null && estado.ultima.horasDesde >= HORAS_PARA_ALARMA;
  const ninguna = estado != null && estado.ultima === null;

  return (
    <section className="mt-6 border-2 border-rule p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold">Copias de seguridad</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[15px] underline underline-offset-4"
        >
          Cerrar
        </button>
      </div>

      <p className="mt-1 text-[14px] leading-snug text-ink-soft">
        Cada noche a las 02:40, antes de que corran las ingestas. Se guardan las últimas
        catorce.
      </p>

      {mensaje && <Notice tone={mensaje.tone}>{mensaje.text}</Notice>}

      {(ninguna || vieja) && (
        <p
          className="mt-4 border-l-4 pl-2.5 text-[14px] leading-snug"
          style={{ borderColor: 'var(--color-roja)' }}
        >
          {ninguna
            ? 'No hay ninguna copia todavía. Si esto sigue así mañana, la copia automática no está corriendo.'
            : 'La última copia tiene más de día y medio. La automática debería correr cada noche: algo se rompió.'}
        </p>
      )}

      {estado?.ultima && (
        <div className="mt-4">
          <p className="eyebrow">Última copia</p>
          <p className="num mt-1 text-[15px]">
            {timeAgo(estado.ultima.fecha)} · {formatBytes(estado.ultima.bytes)}
          </p>
          <p className="num mt-0.5 text-[13px] text-ink-faint">
            {estado.total} guardada{estado.total === 1 ? '' : 's'} ·{' '}
            {new Date(estado.ultima.fecha).toLocaleString('es-CO')}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => void ejecutar()}
        disabled={busy}
        className="mt-4 min-h-[44px] w-full border-2 border-ink px-3 text-[15px] font-semibold disabled:opacity-40"
      >
        {busy ? 'Copiando…' : 'Hacer una copia ahora'}
      </button>

      <p className="mt-2 text-[13px] leading-snug text-ink-faint">
        Úsalo antes de un cambio delicado: tener la copia de anoche no consuela si el cambio se
        aplicó esta mañana.
      </p>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
