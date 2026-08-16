import { serverGet } from '@/lib/server-api';

/**
 * La emergencia que se está cubriendo, en la cabecera.
 *
 * Antes era un texto fijo —"Sismo 10 ago 2026"— y eso significaba que cubrir
 * otra emergencia exigía editar el layout. Ahora sale de la fila del evento: se
 * declara una nueva como principal y todo el sitio la refleja.
 *
 * Si la consulta falla no se muestra nada. Es un rótulo de contexto, no una
 * función: romper la cabecera de todas las páginas porque una petición no
 * respondió sería un mal negocio en una plataforma que tiene que funcionar
 * cuando la red va mal.
 */
interface EventoActual {
  nombre: string;
  ocurrioEl: string;
}

export async function EventChip() {
  let evento: EventoActual | null = null;
  try {
    evento = await serverGet<EventoActual | null>('/eventos/principal');
  } catch {
    return null;
  }

  if (!evento) return null;

  const fecha = new Date(evento.ocurrioEl).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <span
      className="eyebrow"
      style={{ color: 'var(--color-rule)' }}
      title={`${evento.nombre} · ${fecha}`}
    >
      {fecha}
    </span>
  );
}
