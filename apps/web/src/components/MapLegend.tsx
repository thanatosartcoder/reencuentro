import { AMARILLA, NARANJA, ROJA, SIGNAL, VIA } from '@/lib/zone-style';

/**
 * Clave del mapa.
 *
 * No es decoración ni un resumen: es la traducción entre lo que se dibuja y lo
 * que significa. Cada muestra reproduce la forma real del elemento en el mapa
 * —círculo relleno para un reporte puntual, línea para un tramo de vía, anillo
 * hueco para una réplica, área para el daño— porque una fila de cuadraditos de
 * color obliga a adivinar a cuál de las tres cosas rojas se refiere.
 *
 * Va arriba del panel y no plegada por defecto: un mapa que hay que descifrar
 * antes de usarlo no sirve en una emergencia.
 */

/** Punto de reporte: mismo relleno que la capa `zones-point`. */
function DotSample({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="mt-1 inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-paper"
      style={{ background: color, boxShadow: `0 0 0 1px ${color}` }}
    />
  );
}

/** Tramo de vía: misma línea que la capa `paths-line`. */
function LineSample({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="mt-2 inline-block h-1 w-3.5 shrink-0"
      style={{ background: color, outline: '1px solid rgba(18,22,28,.35)' }}
    />
  );
}

/** Réplica: anillo sin relleno, igual que la capa `aftershocks`. */
function RingSample({ color, thick = false }: { color: string; thick?: boolean }) {
  return (
    <span
      aria-hidden
      className="mt-1 inline-block h-3.5 w-3.5 shrink-0 rounded-full"
      style={{ border: `${thick ? 3 : 2}px solid ${color}`, background: 'transparent' }}
    />
  );
}

/** Edificación dañada: área rellena, igual que la capa `damage-fill`. */
function AreaSample() {
  return (
    <span
      aria-hidden
      className="mt-1 inline-block h-3.5 w-3.5 shrink-0"
      style={{ background: 'rgba(139,46,36,.55)', border: '1px solid #d0342c' }}
    />
  );
}

function Row({ sample, label }: { sample: React.ReactNode; label: string }) {
  return (
    <li className="flex gap-2.5">
      {sample}
      <span className="text-[14px] leading-snug">{label}</span>
    </li>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="eyebrow">{title}</p>
      <ul className="mt-1.5 space-y-1.5">{children}</ul>
    </div>
  );
}

export function MapLegend() {
  return (
    <section className="border-2 border-ink p-3">
      <h2 className="text-[16px] font-bold tracking-tight">Qué significa cada símbolo</h2>

      <Group title="Vías">
        <Row sample={<DotSample color={ROJA} />} label="Bloqueada, derrumbe o puente caído" />
        <Row sample={<DotSample color={NARANJA} />} label="Paso restringido" />
        <Row sample={<DotSample color={AMARILLA} />} label="Solo vehículo 4x4" />
        <Row sample={<DotSample color={VIA} />} label="Habilitada" />
        <Row sample={<LineSample color={ROJA} />} label="Tramo afectado, no solo un punto" />
      </Group>

      <Group title="Peligro y operación">
        <Row
          sample={<DotSample color={ROJA} />}
          label="Colapso, incendio, fuga, rescate en curso o personas atrapadas"
        />
        <Row sample={<DotSample color={NARANJA} />} label="Estructura inestable o inundación" />
      </Group>

      <Group title="Ayuda disponible">
        <Row
          sample={<DotSample color={VIA} />}
          label="Albergue, puesto médico, acopio, agua, combustible o zona de aterrizaje"
        />
      </Group>

      <Group title="Servicios">
        <Row sample={<DotSample color={SIGNAL} />} label="Sin señal, sin energía o sin agua" />
      </Group>

      <Group title="Red vial">
        <Row
          sample={
            <span
              aria-hidden
              className="mt-2 inline-block h-0.5 w-3.5 shrink-0"
              style={{ background: '#6b7684' }}
            />
          }
          label="Vía existente según OpenStreetMap. El grosor sigue la jerarquía: troncal, primaria, terciaria, trocha."
        />
        <Row
          sample={
            <span
              aria-hidden
              className="mt-2 inline-block h-0.5 w-3.5 shrink-0"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(90deg,#6b7684 0 3px,transparent 3px 6px)',
              }}
            />
          }
          label="Sin pavimentar. En lluvia puede requerir 4x4."
        />
      </Group>

      <Group title="Fuentes externas">
        <Row sample={<RingSample color="#7a3fb0" />} label="Réplica registrada por el USGS" />
        <Row sample={<RingSample color="#12161c" thick />} label="Sismo principal del 10 de agosto" />
        <Row
          sample={<AreaSample />}
          label="Edificación con daño estimado por satélite (acerca el mapa para verla)"
        />
        <Row
          sample={
            <span
              aria-hidden
              className="mt-1 inline-block h-3.5 w-3.5 shrink-0"
              style={{
                border: '1.5px dashed rgba(18,22,28,.5)',
                background: 'rgba(18,22,28,.04)',
              }}
            />
          }
          label="Área donde sí se evaluó el daño. Fuera de este borde nadie ha mirado."
        />
      </Group>

      <Group title="Municipios">
        <Row
          sample={
            <span
              aria-hidden
              className="mt-0.5 inline-block h-4 w-3.5 shrink-0 border-2 border-ink bg-paper"
            />
          }
          label="Recuadro con el resumen del municipio. Tócalo para ver el detalle."
        />
      </Group>

      {/* Estas reglas se aplican a todos los reportes de la comunidad y son
          justo las que nadie deduce mirando el mapa. */}
      <div className="rule mt-4 pt-3">
        <p className="text-[13px] leading-snug text-ink-soft">
          El <strong className="text-ink">tamaño</strong> del punto crece con la gravedad. Lo{' '}
          <strong className="text-ink">desvanecido</strong> indica que el reporte lleva tiempo sin
          que nadie lo confirme y puede estar vencido.
        </p>
        {/* La advertencia más importante de la leyenda: sin ella, el vacío del
            mapa se lee como buenas noticias. */}
        <p
          className="mt-2 border-l-4 pl-2.5 text-[13px] leading-snug"
          style={{ borderColor: 'var(--color-naranja)' }}
        >
          <strong>Un punto sin marcas no significa que esté bien.</strong> Casi toda el área
          afectada, incluido el Chocó donde estuvo el epicentro, no tiene evaluación de daño
          publicada.
        </p>
      </div>
    </section>
  );
}
