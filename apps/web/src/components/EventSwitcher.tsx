import Link from 'next/link';
import { serverGet } from '@/lib/server-api';

/**
 * Cambiar entre emergencias cubiertas.
 *
 * No aparece con una sola: un selector de una opción es ruido que hay que leer
 * para descubrir que no ofrece nada.
 *
 * La selección va en la URL y no en estado del cliente, para que el enlace se
 * pueda compartir. Alguien que manda "mira cómo quedó Chocó" espera que quien
 * lo abra vea Chocó, no lo que esté en curso ese día.
 */
interface EventoLista {
  slug: string;
  nombre: string;
  ocurrioEl: string;
  principal: boolean;
  estado: 'ACTIVE' | 'MONITORING' | 'CLOSED';
}

export async function EventSwitcher({
  actual,
  base,
}: {
  /** Slug seleccionado; vacío significa la que está en curso. */
  actual?: string;
  /** Ruta sobre la que se construyen los enlaces. */
  base: string;
}) {
  let eventos: EventoLista[] | null = null;
  try {
    eventos = await serverGet<EventoLista[]>('/eventos');
  } catch {
    return null;
  }

  if (!eventos || eventos.length < 2) return null;

  const activa = eventos.find((e) => e.principal);
  const seleccionada = actual ? eventos.find((e) => e.slug === actual) : activa;

  return (
    <nav aria-label="Emergencia" className="rule bg-paper-sunk">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
        <span className="eyebrow text-ink-faint">Emergencia</span>

        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {eventos.map((evento) => {
            const elegida = evento.slug === seleccionada?.slug;
            // La activa se enlaza sin parámetro: su URL es la del sitio, y así
            // volver a "lo de ahora" no deja un enlace con estado pegado.
            const href = evento.principal ? base : `${base}?emergencia=${evento.slug}`;

            return (
              <li key={evento.slug}>
                <Link
                  href={href}
                  aria-current={elegida ? 'page' : undefined}
                  className={`inline-block py-1 text-[14px] underline-offset-4 ${
                    elegida ? 'font-semibold underline' : 'text-ink-soft hover:underline'
                  }`}
                >
                  {evento.nombre}
                  {evento.principal && (
                    <span className="ml-1.5" style={{ color: 'var(--color-roja)' }}>
                      ·
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

/**
 * Aviso de que se está mirando algo que ya no está ocurriendo.
 *
 * Importa más de lo que parece. Sin esto, alguien podría mirar el mapa de una
 * emergencia pasada, tocar "reportar vía cortada" y creer que su reporte
 * describe lo que está viendo — cuando el servidor lo atribuiría a la
 * emergencia en curso, que puede estar a mil kilómetros.
 */
export function ArchivedNotice({ nombre, base }: { nombre: string; base: string }) {
  return (
    <div
      className="border-l-4 bg-paper-sunk px-4 py-3"
      style={{ borderColor: 'var(--color-naranja)' }}
    >
      <p className="mx-auto max-w-5xl text-[15px] leading-snug">
        Estás consultando <strong>{nombre}</strong>, que ya no es la emergencia en curso. Puedes
        mirar, pero no reportar sobre ella.{' '}
        <Link href={base} className="underline underline-offset-4">
          Volver a la emergencia actual
        </Link>
        .
      </p>
    </div>
  );
}
