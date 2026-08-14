'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type MissingPerson } from '@/lib/api';
import { timeAgo } from '@/components/DecayMeter';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: 'En búsqueda', color: 'var(--color-roja)' },
  FOUND_ALIVE: { label: 'Localizada con vida', color: 'var(--color-via)' },
  FOUND_DECEASED: { label: 'Caso cerrado', color: 'var(--color-ink-soft)' },
  MATCHED: { label: 'Posible coincidencia en revisión', color: 'var(--color-naranja)' },
  CANCELLED: { label: 'Reporte retirado', color: 'var(--color-ink-faint)' },
  DUPLICATE: { label: 'Unificado con otro reporte', color: 'var(--color-ink-faint)' },
};

export default function DesaparecidosPage() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<MissingPerson[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [minorsOnly, setMinorsOnly] = useState(false);
  const [offline, setOffline] = useState(false);

  const search = useCallback(async (q: string, onlyMinors: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (q.trim()) params.set('q', q.trim());
      if (onlyMinors) params.set('minorsOnly', 'true');

      const response = await api.get<{ items: MissingPerson[]; total: number }>(
        `/personas/desaparecidos?${params}`,
      );
      setItems(response.items);
      setTotal(response.total);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Se espera a que la persona deje de escribir: en 2G, una petición por
    // pulsación satura la conexión y hace más lenta la búsqueda, no más rápida.
    const timer = window.setTimeout(() => void search(query, minorsOnly), 350);
    return () => window.clearTimeout(timer);
  }, [query, minorsOnly, search]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-[clamp(1.6rem,5.5vw,2.3rem)] font-bold leading-tight tracking-tight">
        Personas reportadas como desaparecidas
      </h1>
      <p className="mt-3 text-[17px] leading-snug text-ink-soft">
        Reportes hechos por familiares y allegados. Si reconoces a alguien o sabes dónde está,{' '}
        <Link href="/avistamientos/nuevo" className="font-semibold text-ink underline underline-offset-4">
          repórtalo aquí
        </Link>
        .
      </p>

      <div className="mt-6">
        <label htmlFor="buscar" className="block text-[16px] font-semibold">
          Buscar por nombre
        </label>
        <p className="mb-1.5 mt-0.5 text-[14px] text-ink-faint">
          No importa si lo escribes con errores o sin tildes.
        </p>
        <input
          id="buscar"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full border-2 border-rule bg-paper px-3 py-3 text-[17px] focus:border-ink focus:outline-none"
          autoComplete="off"
        />

        <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-[16px]">
          <input
            type="checkbox"
            checked={minorsOnly}
            onChange={(e) => setMinorsOnly(e.target.checked)}
            className="h-5 w-5 accent-[#12161c]"
          />
          Mostrar solo menores de edad
        </label>
      </div>

      <div className="mt-6 flex items-baseline justify-between">
        <p className="eyebrow">
          {loading ? 'Buscando…' : `${total} ${total === 1 ? 'reporte' : 'reportes'}`}
        </p>
      </div>

      {offline && (
        <div
          className="mt-3 border-l-4 bg-paper-sunk px-4 py-3 text-[16px]"
          style={{ borderColor: 'var(--color-naranja)' }}
        >
          Sin conexión. La búsqueda de personas necesita señal; el mapa sí funciona con la copia
          guardada en este teléfono.
        </div>
      )}

      {!loading && !offline && items.length === 0 && (
        <div className="mt-6 border-2 border-rule px-4 py-6">
          <p className="text-[17px] font-semibold">
            {query ? `Nadie coincide con "${query}"` : 'Todavía no hay reportes'}
          </p>
          <p className="mt-2 text-[16px] leading-snug text-ink-soft">
            {query
              ? 'Prueba con solo el apellido, o revisa el listado completo borrando la búsqueda.'
              : 'Cuando alguien registre un reporte aparecerá aquí.'}
          </p>
        </div>
      )}

      <ul className="mt-4">
        {items.map((person) => {
          const status = STATUS_LABELS[person.status] ?? STATUS_LABELS.ACTIVE;
          return (
            <li key={person.id} className="rule">
              <Link href={`/desaparecidos/${person.id}`} className="flex gap-3 py-4 hover:bg-paper-sunk">
                {person.photos[0] ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={person.photos[0].url}
                    alt=""
                    className="h-20 w-20 shrink-0 border border-rule object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center border border-rule bg-paper-sunk">
                    <span className="eyebrow text-center leading-tight">sin
                      <br />
                      foto
                    </span>
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-[18px] font-semibold leading-tight">{person.fullName}</p>

                  <p className="mt-1 text-[15px] leading-snug text-ink-soft">
                    {[
                      person.age !== null ? `${person.age} años` : null,
                      sexLabel(person.sex),
                      [person.municipality, person.department].filter(Boolean).join(', ') || null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>

                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="stamp" style={{ color: status.color }}>
                      {status.label}
                    </span>
                    {person.isMinor && (
                      <span className="stamp" style={{ color: 'var(--color-roja)' }}>
                        menor de edad
                      </span>
                    )}
                    <span className="num text-[13px] text-ink-faint">
                      reportado {timeAgo(person.reportedAt)}
                    </span>
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function sexLabel(sex: string): string | null {
  return { MALE: 'hombre', FEMALE: 'mujer', OTHER: null, UNKNOWN: null }[sex] ?? null;
}
