'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type IngestStatus } from '@/lib/api';
import { timeAgo } from '@/components/DecayMeter';
import { Notice } from '@/components/Form';

/**
 * Estado de las fuentes externas y disparo manual.
 *
 * Las tres se refrescan solas —las réplicas cada cinco minutos, las otras dos
 * de madrugada— así que este panel no es la vía normal. Existe para cuando una
 * fuente publica una corrección urgente y no se puede esperar al cron: en una
 * emergencia, "mañana a las cuatro" a veces no sirve.
 *
 * Y para lo que no es un botón: dice **cuándo** se actualizó cada capa. Un dato
 * de terceros sin fecha de carga invita a confiar en él más de lo que merece, y
 * una ingesta que lleva días fallando produce un mapa que parece al día.
 */

interface SeismicSummary {
  total: number;
  latest: { magnitude: number; occurredAt: string; place: string | null } | null;
  lastSyncedAt: string | null;
}

type SourceKey = 'SEISMIC' | 'HDX_DAMAGE' | 'HOT_ROADS';

const SOURCES: {
  key: SourceKey;
  nombre: string;
  origen: string;
  descripcion: string;
  cadencia: string;
  /** Cuánto suele tardar, para que nadie crea que se colgó. */
  duracion: string;
}[] = [
  {
    key: 'SEISMIC',
    nombre: 'Réplicas sísmicas',
    origen: 'USGS',
    descripcion: 'Sismos en 300 km del epicentro, magnitud 2.5 o mayor.',
    cadencia: 'automático cada 5 min',
    duracion: 'segundos',
  },
  {
    key: 'HDX_DAMAGE',
    nombre: 'Daño en edificaciones',
    origen: 'Microsoft AI for Good · HDX',
    descripcion:
      'Evaluación por satélite. Solo hay publicación para Cali y Pereira; el resto del área, incluido Chocó, sigue sin evaluar.',
    cadencia: 'automático 03:20',
    duracion: 'medio minuto',
  },
  {
    key: 'HOT_ROADS',
    nombre: 'Red vial',
    origen: 'HOT · OpenStreetMap',
    descripcion:
      'Qué vías existen y cómo se llaman. Alimenta el autocompletado al reportar una vía cortada.',
    cadencia: 'automático 04:20',
    duracion: 'unos 3 minutos',
  },
];

export function DataSources({ token }: { token: string }) {
  const [ingest, setIngest] = useState<IngestStatus | null>(null);
  const [seismic, setSeismic] = useState<SeismicSummary | null>(null);
  const [running, setRunning] = useState<SourceKey | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const pollRef = useRef<number | null>(null);

  const auth = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const [i, s] = await Promise.all([
        api.get<IngestStatus>('/ingesta/estado'),
        api.get<SeismicSummary>('/sismos/resumen'),
      ]);
      setIngest(i);
      setSeismic(s);
      return i;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Se limpia el sondeo al desmontar: si no, sigue pidiendo estado con el panel
  // cerrado o después de cerrar sesión.
  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  const refresh = async (key: SourceKey) => {
    setRunning(key);
    setMessage(null);

    try {
      if (key === 'SEISMIC') {
        // Es rápida, así que responde con el resultado directamente.
        const r = await api.post<{ fetched: number; created: number }>(
          '/sismos/sincronizar',
          {},
          { headers: auth },
        );
        await load();
        setMessage({
          tone: 'ok',
          text: r.created
            ? `${r.created} evento${r.created === 1 ? '' : 's'} nuevo${r.created === 1 ? '' : 's'} del USGS.`
            : 'Sin novedades: el USGS no ha publicado eventos nuevos.',
        });
        setRunning(null);
        return;
      }

      await api.post('/ingesta/ejecutar', { source: key }, { headers: auth });
      setMessage({
        tone: 'warn',
        text: 'Arrancó en segundo plano. Puedes cerrar esto: el avance se guarda igual.',
      });

      // La ingesta corre en el servidor; aquí solo se consulta su estado.
      let intentos = 0;
      pollRef.current = window.setInterval(async () => {
        intentos++;
        const estado = await load();
        const fuente = estado?.fuentes.find((f) => f.fuente === key);
        const intento = fuente?.ultimoIntento;

        const terminada =
          intento && ['SUCCESS', 'SKIPPED', 'FAILED'].includes(intento.estado);

        if (terminada || intentos > 90) {
          if (pollRef.current) window.clearInterval(pollRef.current);
          setRunning(null);

          if (intento?.estado === 'SUCCESS') {
            setMessage({
              tone: 'ok',
              text: `Actualizada: ${(fuente?.registros ?? 0).toLocaleString('es-CO')} registros.`,
            });
          } else if (intento?.estado === 'SKIPPED') {
            setMessage({
              tone: 'ok',
              text: 'La fuente no ha cambiado desde la última carga. No se descargó nada.',
            });
          } else if (intento?.estado === 'FAILED') {
            setMessage({ tone: 'error', text: intento.error ?? 'La ingesta falló.' });
          } else {
            setMessage({
              tone: 'warn',
              text: 'Sigue trabajando. Vuelve a abrir esto en un rato para ver el resultado.',
            });
          }
        }
      }, 4000);
    } catch (err) {
      setRunning(null);
      setMessage({
        tone: 'error',
        text:
          err instanceof ApiError
            ? err.status === 403
              ? 'Necesitas rol de coordinador para refrescar las fuentes.'
              : err.message
            : 'No se pudo iniciar.',
      });
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
          <span className="text-[16px] font-semibold">Fuentes de datos</span>
          <span className="text-[13px] text-ink-faint">ver estado y actualizar →</span>
        </span>
      </button>
    );
  }

  return (
    <section className="mt-6 border-2 border-rule p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold">Fuentes de datos</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[15px] underline underline-offset-4"
        >
          Cerrar
        </button>
      </div>

      <p className="mt-1 text-[14px] leading-snug text-ink-soft">
        Se actualizan solas. Refrescar a mano sirve cuando una fuente publica una corrección
        y no se puede esperar al horario automático.
      </p>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <ul className="mt-4 space-y-3">
        {SOURCES.map((source) => {
          const fuente = ingest?.fuentes.find((f) => f.fuente === source.key);
          const fallo = fuente?.ultimoIntento?.estado === 'FAILED';

          const actualizado =
            source.key === 'SEISMIC'
              ? seismic?.lastSyncedAt
              : (fuente?.ultimaCargaExitosa ?? null);

          const registros =
            source.key === 'SEISMIC' ? (seismic?.total ?? null) : (fuente?.registros ?? null);

          return (
            <li key={source.key} className="rule pt-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-[16px] font-semibold">{source.nombre}</span>
                <span className="stamp text-ink-faint">{source.origen}</span>
              </div>

              <p className="mt-1 text-[14px] leading-snug text-ink-soft">{source.descripcion}</p>

              <p className="num mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-ink-faint">
                {registros !== null && <span>{registros.toLocaleString('es-CO')} registros</span>}
                {actualizado ? (
                  <span>actualizado {timeAgo(actualizado)}</span>
                ) : (
                  <span>sin cargar</span>
                )}
                <span>{source.cadencia}</span>
                {fallo && (
                  <span style={{ color: 'var(--color-roja)' }}>· el último intento falló</span>
                )}
              </p>

              <button
                type="button"
                onClick={() => void refresh(source.key)}
                disabled={running !== null}
                className="mt-2 min-h-[44px] w-full border-2 border-ink px-3 text-[15px] font-semibold disabled:opacity-40"
              >
                {running === source.key
                  ? 'Actualizando…'
                  : `Actualizar ahora (${source.duracion})`}
              </button>
            </li>
          );
        })}
      </ul>

      {ingest && !ingest.cronActivo && (
        <p
          className="mt-4 border-l-4 pl-2.5 text-[13px] leading-snug"
          style={{ borderColor: 'var(--color-naranja)' }}
        >
          La actualización automática está desactivada en este despliegue
          (<code>INGEST_CRON_ENABLED=false</code>). Las fuentes solo se refrescan desde aquí.
        </p>
      )}
    </section>
  );
}
