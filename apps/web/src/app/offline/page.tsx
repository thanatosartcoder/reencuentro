import Link from 'next/link';

/**
 * Pantalla que sirve el service worker cuando no hay red ni copia local de la
 * página pedida. Su trabajo es decir qué sí se puede hacer, no disculparse.
 */
export default function OfflinePage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <span
        aria-hidden
        className="block h-1.5 w-16"
        style={{ background: 'var(--color-naranja)' }}
      />
      <h1 className="mt-4 text-[clamp(1.6rem,5.5vw,2.3rem)] font-bold leading-tight tracking-tight">
        Esta pantalla necesita señal
      </h1>
      <p className="mt-3 text-[17px] leading-snug">
        No hay conexión y esta página no está guardada en el teléfono. Lo que sí puedes hacer
        ahora mismo:
      </p>

      <ul className="mt-6 space-y-3">
        <li>
          <Link
            href="/desaparecidos/nuevo"
            className="flex min-h-[60px] items-center border-2 border-ink px-4 text-[17px] font-semibold"
          >
            Reportar a una persona desaparecida
          </Link>
        </li>
        <li>
          <Link
            href="/mapa"
            className="flex min-h-[60px] items-center border-2 border-ink px-4 text-[17px] font-semibold"
          >
            Ver el mapa descargado
          </Link>
        </li>
        <li>
          <Link
            href="/pendientes"
            className="flex min-h-[60px] items-center border-2 border-ink px-4 text-[17px] font-semibold"
          >
            Ver lo que está guardado sin enviar
          </Link>
        </li>
      </ul>

      <p className="mt-8 text-[16px] leading-snug text-ink-soft">
        Todo lo que reportes sin señal queda guardado y se envía solo cuando vuelva la conexión.
        No necesitas volver a escribirlo.
      </p>
    </div>
  );
}
