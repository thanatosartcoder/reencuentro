'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { timeAgo } from '@/components/DecayMeter';
import { Notice } from '@/components/Form';

/**
 * Retirar de la vista pública un reporte o un avistamiento.
 *
 * Cualquiera puede publicar aquí, de forma anónima y sin revisión previa, un
 * reporte con el nombre completo de una persona real, su descripción física, una
 * ubicación y una foto. Eso es deliberado —pedir cuenta para reportar a un
 * desaparecido cuesta reportes— pero hasta ahora no había ninguna forma de bajar
 * una publicación difamatoria salvo escribir SQL contra producción.
 *
 * Dos decisiones sobre cómo está hecha esta pantalla:
 *
 * **Se busca antes de retirar.** Quien recibe la queja tiene un nombre, no un
 * identificador. Sin búsqueda esto sería una caja donde pegar un UUID que nadie
 * tiene a mano, y una herramienta que no se puede usar en el momento en que hace
 * falta es una herramienta que no existe.
 *
 * **Lo retirado se ve y se puede deshacer.** Retirar el reporte de una
 * desaparición real deja a una familia sin su caso y sin saber por qué. Una
 * moderación irreversible es su propio riesgo, así que la lista de abajo está al
 * mismo nivel que la búsqueda, no escondida.
 */

interface Encontrado {
  id: string;
  fullName: string;
  municipality: string | null;
  department: string | null;
  reportedAt: string;
  status: string;
}

interface Retirado {
  id: string;
  fullName: string | null;
  municipality: string | null;
  department: string | null;
  motivo: string | null;
  retiradoPor: string | null;
  retiradoEl: string;
  reportadoEl: string;
}

type Mensaje = { tone: 'ok' | 'warn' | 'error'; text: string };

/** Lo que el servidor exige como mínimo para aceptar una retirada. */
const MOTIVO_MINIMO = 10;

export function Moderacion({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [consulta, setConsulta] = useState('');
  const [resultados, setResultados] = useState<Encontrado[] | null>(null);
  const [retirados, setRetirados] = useState<{
    desaparecidos: Retirado[];
    avistamientos: Retirado[];
  } | null>(null);
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);

  const auth = { Authorization: `Bearer ${token}` };

  const cargarRetirados = useCallback(async () => {
    try {
      setRetirados(
        await api.get<{ desaparecidos: Retirado[]; avistamientos: Retirado[] }>(
          '/personas/retirados',
          { headers: auth },
        ),
      );
    } catch (err) {
      setMensaje({
        tone: 'error',
        text:
          err instanceof ApiError && err.status === 403
            ? 'Necesitas rol de coordinador para moderar.'
            : 'No se pudo consultar lo retirado.',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (open) void cargarRetirados();
  }, [open, cargarRetirados]);

  const buscar = async (event: React.FormEvent) => {
    event.preventDefault();
    const q = consulta.trim();
    if (q.length < 3) {
      setMensaje({ tone: 'warn', text: 'Escribe al menos tres letras del nombre.' });
      return;
    }
    setMensaje(null);
    try {
      // La misma búsqueda pública: es la que ve quien reporta la queja.
      const page = await api.get<{ items: Encontrado[] }>(
        `/personas/desaparecidos?q=${encodeURIComponent(q)}&limit=20`,
      );
      setResultados(page.items);
      if (!page.items.length) {
        setMensaje({
          tone: 'warn',
          text: 'Sin resultados. Si el reporte no tiene consentimiento de publicación, no aparece aquí.',
        });
      }
    } catch {
      setMensaje({ tone: 'error', text: 'No se pudo buscar.' });
    }
  };

  const retirar = async (tipo: 'desaparecidos' | 'avistamientos', id: string) => {
    const motivo = (motivos[id] ?? '').trim();
    if (motivo.length < MOTIVO_MINIMO) {
      setMensaje({ tone: 'warn', text: 'Explica en una frase por qué se retira.' });
      return;
    }
    setBusy(id);
    setMensaje(null);
    try {
      await api.post(`/personas/${tipo}/${id}/retirar`, { motivo }, { headers: auth });
      setResultados((r) => (r ? r.filter((x) => x.id !== id) : r));
      setMotivos((m) => ({ ...m, [id]: '' }));
      setMensaje({ tone: 'ok', text: 'Retirado. Ya no aparece en ninguna vista pública.' });
      await cargarRetirados();
    } catch (err) {
      setMensaje({
        tone: 'error',
        text: err instanceof ApiError ? err.message : 'No se pudo retirar.',
      });
    } finally {
      setBusy(null);
    }
  };

  const restaurar = async (tipo: 'desaparecidos' | 'avistamientos', id: string) => {
    setBusy(id);
    setMensaje(null);
    try {
      await api.post(`/personas/${tipo}/${id}/restaurar`, {}, { headers: auth });
      setMensaje({ tone: 'ok', text: 'Restaurado. Vuelve a verse en público.' });
      await cargarRetirados();
    } catch (err) {
      setMensaje({
        tone: 'error',
        text: err instanceof ApiError ? err.message : 'No se pudo restaurar.',
      });
    } finally {
      setBusy(null);
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
          <span className="text-[16px] font-semibold">Moderación</span>
          <span className="text-[13px] text-ink-faint">retirar publicaciones →</span>
        </span>
      </button>
    );
  }

  const totalRetirados =
    (retirados?.desaparecidos.length ?? 0) + (retirados?.avistamientos.length ?? 0);

  return (
    <section className="mt-6 border-2 border-rule p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold">Moderación</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[15px] underline underline-offset-4"
        >
          Cerrar
        </button>
      </div>

      <p className="mt-1 text-[14px] leading-snug text-ink-soft">
        Retira de la vista pública una publicación falsa o difamatoria. No se borra: se puede
        deshacer, y queda en la bitácora quién lo hizo y por qué.
      </p>

      {mensaje && <Notice tone={mensaje.tone}>{mensaje.text}</Notice>}

      <form onSubmit={buscar} className="mt-4">
        <label className="eyebrow" htmlFor="mod-q">
          Buscar por nombre
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="mod-q"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Nombre de la persona"
            className="min-h-[44px] flex-1 border-2 border-rule px-3 text-[16px]"
          />
          <button
            type="submit"
            className="min-h-[44px] border-2 border-ink px-4 text-[15px] font-semibold"
          >
            Buscar
          </button>
        </div>
      </form>

      {resultados?.map((r) => (
        <article key={r.id} className="mt-4 border-l-4 border-rule pl-3">
          <p className="text-[16px] font-semibold">{r.fullName}</p>
          <p className="num text-[13px] text-ink-faint">
            {[r.municipality, r.department].filter(Boolean).join(', ') || 'Sin ubicación'} ·{' '}
            {timeAgo(r.reportedAt)} · {r.status}
          </p>
          <textarea
            value={motivos[r.id] ?? ''}
            onChange={(e) => setMotivos((m) => ({ ...m, [r.id]: e.target.value }))}
            placeholder="Por qué se retira (queda en la bitácora)"
            rows={2}
            className="mt-2 w-full border-2 border-rule px-2 py-1.5 text-[15px]"
          />
          <button
            type="button"
            onClick={() => void retirar('desaparecidos', r.id)}
            disabled={busy === r.id}
            className="mt-1 min-h-[44px] w-full border-2 px-3 text-[15px] font-semibold disabled:opacity-40"
            style={{ borderColor: 'var(--color-roja)', color: 'var(--color-roja)' }}
          >
            {busy === r.id ? 'Retirando…' : 'Retirar de la vista pública'}
          </button>
        </article>
      ))}

      <div className="mt-6 border-t-2 border-rule pt-4">
        <p className="eyebrow">Retirado ({totalRetirados})</p>
        {totalRetirados === 0 && (
          <p className="mt-1 text-[14px] text-ink-faint">Nada retirado por ahora.</p>
        )}

        {(['desaparecidos', 'avistamientos'] as const).map((tipo) =>
          (retirados?.[tipo] ?? []).map((r) => (
            <article key={r.id} className="mt-3 border-l-4 border-rule pl-3">
              <p className="text-[15px] font-semibold">
                {r.fullName ?? 'Sin nombre'}{' '}
                <span className="text-[13px] font-normal text-ink-faint">
                  {tipo === 'avistamientos' ? '· avistamiento' : ''}
                </span>
              </p>
              <p className="mt-0.5 text-[14px] leading-snug">{r.motivo ?? 'Sin motivo registrado'}</p>
              <p className="num mt-0.5 text-[13px] text-ink-faint">
                {r.retiradoPor ?? 'desconocido'} · {timeAgo(r.retiradoEl)}
              </p>
              <button
                type="button"
                onClick={() => void restaurar(tipo, r.id)}
                disabled={busy === r.id}
                className="mt-1 text-[15px] underline underline-offset-4 disabled:opacity-40"
              >
                {busy === r.id ? 'Restaurando…' : 'Restaurar'}
              </button>
            </article>
          )),
        )}
      </div>
    </section>
  );
}
