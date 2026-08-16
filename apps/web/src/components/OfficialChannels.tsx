/**
 * Canales oficiales de búsqueda de personas.
 *
 * Va donde alguien está a punto de reportar una desaparición, y va **antes** del
 * formulario, no después.
 *
 * La Cruz Roja Colombiana tiene un servicio activo de Restablecimiento del
 * Contacto Familiar para este sismo, con capacidad de búsqueda real y con
 * acceso a la red del Movimiento. Esta plataforma no la reemplaza. Recibir un
 * reporte aquí y que la familia crea que ya hizo lo que tenía que hacer sería
 * el peor resultado posible: un caso quieto en una cola en vez de en manos de
 * quien puede buscar.
 *
 * Por eso el texto dice "también" y no "en vez de", y por eso está arriba: si
 * estuviera al final, lo leería solo quien ya terminó de escribir.
 */
export function OfficialChannels() {
  return (
    <aside
      className="mt-5 border-l-4 bg-paper-sunk px-4 py-3"
      style={{ borderColor: 'var(--color-roja)' }}
    >
      <p className="text-[16px] font-semibold leading-snug">
        Repórtalo también a la Cruz Roja
      </p>

      <p className="mt-1.5 text-[15px] leading-snug text-ink-soft">
        Su programa de Restablecimiento del Contacto Familiar está activo para este sismo y
        tiene capacidad de búsqueda que esta plataforma no tiene. Esto no la reemplaza.
      </p>

      <ul className="num mt-2 space-y-1 text-[15px]">
        <li>
          WhatsApp{' '}
          <a
            href="https://wa.me/573212139525"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-4"
          >
            +57 321 213 9525
          </a>
        </li>
        <li>
          <a
            href="mailto:rcf@cruzrojacolombiana.org"
            className="underline underline-offset-4"
          >
            rcf@cruzrojacolombiana.org
          </a>
        </li>
      </ul>

      <p className="mt-2 text-[14px] leading-snug text-ink-faint">
        Si hay una emergencia en curso, llama al <strong className="num">123</strong>.
      </p>
    </aside>
  );
}
