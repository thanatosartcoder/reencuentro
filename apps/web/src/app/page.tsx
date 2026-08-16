import Link from 'next/link';
import { serverGet } from '@/lib/server-api';
import { ArchivedNotice, EventSwitcher } from '@/components/EventSwitcher';
import type { SituationOverview } from '@/lib/api';
import { ElapsedSince } from '@/components/ElapsedSince';

const ALERT_COLORS: Record<string, string> = {
  ROJA: 'var(--color-roja)',
  NARANJA: 'var(--color-naranja)',
  AMARILLA: 'var(--color-amarilla)',
};

interface SeismicSummary {
  total: number;
  mainshock: { magnitude: number; depthKm: number | null; place: string | null } | null;
  latest: { magnitude: number; occurredAt: string; place: string | null } | null;
  byMagnitude: { rango: string; conteo: number }[];
  lastSyncedAt: string | null;
}

interface DamageSummary {
  porCiudad: {
    ciudad: string;
    danadas: number;
    evaluadas: number;
    fuenteImagen: string | null;
    fechaImagen: string | null;
  }[];
  totalDanadas: number;
  /** Puede faltar si la respuesta viene de una versión anterior de la API. */
  ciudadesEvaluadas?: string[];
}

/**
 * Ciudades con evaluación publicada.
 *
 * Se deriva de `porCiudad` cuando el campo dedicado no viene: es la misma
 * información desde otro ángulo. Una página que se cae porque una API externa
 * cambió de forma es peor que una página que muestra un dato de menos, y aquí
 * el resto de la pantalla incluye las líneas de emergencia.
 */
function evaluatedCities(damage: DamageSummary): string[] {
  return damage.ciudadesEvaluadas?.length
    ? damage.ciudadesEvaluadas
    : damage.porCiudad.map((c) => c.ciudad);
}

export default async function SituacionPage({
  searchParams,
}: {
  searchParams: Promise<{ emergencia?: string }>;
}) {
  const { emergencia } = await searchParams;
  const q = emergencia ? `?evento=${encodeURIComponent(emergencia)}` : '';

  // Las tres se piden en paralelo y cada una puede faltar sin tumbar la página:
  // provienen de fuentes distintas con disponibilidad distinta.
  const [data, seismic, damage] = await Promise.all([
    serverGet<SituationOverview>(`/situacion${q}`),
    serverGet<SeismicSummary>(`/sismos/resumen${q}`),
    serverGet<DamageSummary>(`/danos/resumen${q}`),
  ]);

  // Consultar una emergencia pasada es solo eso: consultarla. Reportar sobre
  // ella no tendría a dónde ir — el servidor atribuye todo reporte nuevo a la
  // emergencia en curso, que puede estar a mil kilómetros de lo que se mira.
  const soloConsulta = Boolean(data?.emergencia && !data.emergencia.enCurso);

  return (
    <div>
      <EventSwitcher actual={emergencia} base="/" />

      {soloConsulta && data?.emergencia && (
        <ArchivedNotice nombre={data.emergencia.nombre} base="/" />
      )}
      {/* Encabezado de boletín, no hero de marketing. Lo primero que se lee es
          qué pasó, dónde y cuánto tiempo lleva pasando. */}
      <section className="bg-ink text-paper">
        <div className="mx-auto max-w-5xl px-4 pb-8 pt-7">
          <p className="eyebrow" style={{ color: 'var(--color-roja)' }}>
            Emergencia activa
          </p>

          {/* El título sale de la emergencia declarada, no de una constante:
              cubrir otra no debería exigir editar este archivo. */}
          <h1 className="mt-2 text-[clamp(1.9rem,7vw,3.1rem)] font-bold leading-[1.05] tracking-tight">
            {data?.emergencia?.nombre ?? 'Emergencia en curso'}
          </h1>

          {data?.emergencia && data.emergencia.departamentos.length > 0 && (
            <p className="mt-2 text-[15px] leading-snug text-paper/75">
              {data.emergencia.departamentos.join(' · ')}
            </p>
          )}

          {/* Los parámetros sísmicos solo existen si la emergencia lo es y hay
              boletín publicado. Una inundación no tiene magnitud. */}
          {data?.evento && (
            <dl className="num mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-4">
              <Spec label="Magnitud" value={`M ${data.evento.magnitude}`} />
              <Spec label="Profundidad" value={`${data.evento.depthKm} km`} />
              <Spec
                label="Epicentro"
                value={`${data.evento.epicenter.latitude.toFixed(2)} N ${Math.abs(
                  data.evento.epicenter.longitude,
                ).toFixed(2)} W`}
              />
              <Spec label="Réplicas" value={`${data.evento.aftershocksReported}+`} />
            </dl>
          )}

          <div className="mt-7 border-t border-paper/25 pt-4">
            <p className="eyebrow" style={{ color: 'var(--color-rule)' }}>
              Tiempo transcurrido
            </p>
            <p className="mt-1 text-[clamp(1.15rem,4.5vw,1.75rem)] font-semibold">
              <ElapsedSince iso={data?.emergencia?.ocurrioEl ?? ''} />
            </p>
          </div>
        </div>
      </section>

      {/* Tres destinos, nada más. Quien llega aquí viene a hacer una de tres
          cosas y debe poder empezarla sin leer nada más.

          En modo consulta no se ofrecen: reportar sobre una emergencia que ya
          no está en curso llevaría el reporte a la que sí lo está, que puede
          estar a mil kilómetros de lo que la persona está mirando. */}
      {!soloConsulta && (
      <section className="mx-auto max-w-5xl px-4 py-8">
        <div className="grid gap-3 sm:grid-cols-3">
          <BigAction
            href="/desaparecidos/nuevo"
            accent="var(--color-roja)"
            title="Reportar a alguien"
            detail="No encuentro a un familiar o a un conocido"
          />
          <BigAction
            href="/avistamientos/nuevo"
            accent="var(--color-via)"
            title="Vi a alguien"
            detail="Encontré a una persona o la tengo aquí conmigo"
          />
          <BigAction
            href="/mapa"
            accent="var(--color-signal)"
            title="Ver el mapa"
            detail="Qué vías están abiertas y dónde hay ayuda"
          />
        </div>
      </section>
      )}

      {/* En modo consulta se ofrece el mapa igual: mirar el mapa de una
          emergencia pasada es exactamente lo que se vino a hacer. */}
      {soloConsulta && (
        <section className="mx-auto max-w-5xl px-4 py-8">
          <BigAction
            href={`/mapa?emergencia=${data?.emergencia?.slug ?? ''}`}
            accent="var(--color-signal)"
            title="Ver el mapa de esta emergencia"
            detail="Vías, zonas y daño tal como quedaron registrados"
          />
        </section>
      )}

      {/* Cifras oficiales, marcadas como tales y con su corte. Presentarlas
          junto a los reportes de la plataforma sin distinguirlas le daría a
          estos últimos una autoridad que no tienen. */}
      {/* Sin balance oficial publicado no se muestran ceros: se dice que
          todavía no lo hay. Un cero se lee como "aquí no pasó nada", y en una
          emergencia recién declarada eso es lo contrario de la verdad. */}
      {data && !data.cifrasOficiales && (
        <section className="mx-auto max-w-5xl px-4 pb-10">
          <p
            className="border-l-4 pl-3 text-[16px] leading-snug text-ink-soft"
            style={{ borderColor: 'var(--color-naranja)' }}
          >
            Todavía no hay un balance oficial publicado para esta emergencia. Las cifras de
            abajo son solo de los reportes hechos en esta plataforma.
          </p>
        </section>
      )}

      {data?.cifrasOficiales && (
        <section className="mx-auto max-w-5xl px-4 pb-10">
          <div className="border-2 border-ink">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink px-4 py-3">
              <h2 className="text-[19px] font-bold tracking-tight">Cifras oficiales</h2>
              <span className="stamp text-ink-soft">
                {data.cifrasOficiales.source} · corte{' '}
                {new Date(data.cifrasOficiales.asOf).toLocaleDateString('es-CO', {
                  day: 'numeric',
                  month: 'short',
                })}
              </span>
            </header>

            <dl className="grid grid-cols-2 sm:grid-cols-4">
              <Figure
                value={data.cifrasOficiales.missing}
                label="desaparecidos"
                accent="var(--color-roja)"
                emphasis
              />
              <Figure value={data.cifrasOficiales.deceased} label="fallecidos" />
              <Figure value={data.cifrasOficiales.injured} label="heridos" />
              <Figure
                value={data.cifrasOficiales.rescued}
                label="rescatados"
                accent="var(--color-via)"
              />
            </dl>

            <div className="rule px-4 py-3">
              <dl className="num grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
                <Spec
                  label="Personas afectadas"
                  value={data.cifrasOficiales.affectedPeople.toLocaleString('es-CO')}
                  dark
                />
                <Spec
                  label="Familias"
                  value={data.cifrasOficiales.affectedFamilies.toLocaleString('es-CO')}
                  dark
                />
                <Spec
                  label="Viviendas destruidas"
                  value={data.cifrasOficiales.housesDestroyed.toLocaleString('es-CO')}
                  dark
                />
                <Spec
                  label="Municipios"
                  value={`${data.cifrasOficiales.municipalitiesAffected} en ${data.cifrasOficiales.departmentsAffected} dptos.`}
                  dark
                />
              </dl>
            </div>
          </div>
        </section>
      )}

      {/* Datos de terceros con su procedencia al lado. Van después de las
          cifras oficiales y antes de las de la plataforma, porque ese es su
          lugar en la escala de autoridad: verificables, pero no oficiales. */}
      {(seismic?.total || damage?.totalDanadas) && (
        <section className="mx-auto max-w-5xl px-4 pb-10">
          <h2 className="text-[19px] font-bold tracking-tight">Monitoreo de fuentes abiertas</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {seismic?.total ? (
              <article className="border-2 border-rule p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[17px] font-semibold">Secuencia sísmica</h3>
                  <span className="stamp text-ink-faint">USGS</span>
                </div>

                <p className="num mt-3 text-[26px] font-bold leading-none">
                  {seismic.total}
                  <span className="ml-2 text-[14px] font-normal text-ink-soft">
                    eventos M ≥ 2.5
                  </span>
                </p>

                {seismic.latest && (
                  <p className="mt-2 text-[15px] leading-snug text-ink-soft">
                    Última: <strong className="num text-ink">M {seismic.latest.magnitude}</strong>{' '}
                    {seismic.latest.place}
                  </p>
                )}

                {/* Advertencia necesaria: la red global detecta menos réplicas
                    que la red local, y la diferencia entre las dos cifras se
                    lee como contradicción si no se explica. */}
                <p className="mt-3 border-t border-rule pt-3 text-[13px] leading-snug text-ink-faint">
                  La red global del USGS detecta menos réplicas que la red del Servicio
                  Geológico Colombiano, más densa dentro del país. El SGC reportó más de 130
                  réplicas al 12 de agosto.
                </p>
              </article>
            ) : null}

            {damage?.totalDanadas ? (
              <article className="border-2 border-rule p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[17px] font-semibold">Daño en edificaciones</h3>
                  <span className="stamp text-ink-faint">HDX</span>
                </div>

                <p className="num mt-3 text-[26px] font-bold leading-none">
                  {damage.totalDanadas}
                  <span className="ml-2 text-[14px] font-normal text-ink-soft">
                    con daño detectado
                  </span>
                </p>

                <dl className="num mt-2 space-y-1 text-[14px]">
                  {damage.porCiudad.map((city) => (
                    <div key={city.ciudad} className="flex justify-between gap-3">
                      <dt className="text-ink-soft">{city.ciudad}</dt>
                      <dd>
                        {city.danadas} de {city.evaluadas.toLocaleString('es-CO')}
                      </dd>
                    </div>
                  ))}
                </dl>

                {/* La cobertura va junto a la cifra, no en una nota al pie: sin
                    ella "575 dañadas" se lee como el total del país cuando es el
                    total de dos ciudades. */}
                <p
                  className="mt-3 border-l-4 pl-2.5 text-[13px] leading-snug"
                  style={{ borderColor: 'var(--color-naranja)' }}
                >
                  Solo se evaluaron <strong>{evaluatedCities(damage).join(' y ')}</strong>. El
                  resto del área afectada —incluido el Chocó, donde estuvo el epicentro— no
                  tiene evaluación publicada. La ausencia de datos no es ausencia de daño.
                </p>

                <p className="mt-3 border-t border-rule pt-3 text-[13px] leading-snug text-ink-faint">
                  Estimación de un modelo del Microsoft AI for Good Lab sobre imagen
                  satelital. Orienta dónde inspeccionar; no reemplaza la evaluación de un
                  ingeniero en sitio ni determina habitabilidad.
                </p>
              </article>
            ) : null}
          </div>
        </section>
      )}

      {/* Capitales en alerta. La banda de color es el mismo código que usa la
          señalización oficial, así que significa aquí lo que significa allá. */}
      {/* La sección entera depende del boletín oficial: sin él no hay
          capitales que clasificar por nivel de alerta. */}
      {data?.cifrasOficiales && data.capitalesAfectadas.length > 0 && (
        <section className="mx-auto max-w-5xl px-4 pb-10">
          <h2 className="text-[19px] font-bold tracking-tight">Ciudades en alerta</h2>
          <p className="mt-1 text-[15px] text-ink-soft">
            Las capitales en alerta roja concentran la mayoría de los{' '}
            {data.cifrasOficiales.missing} desaparecidos.
          </p>

          <ul className="mt-4">
            {data.capitalesAfectadas.map((city) => (
              <li key={city.name} className="rule flex gap-3 py-3">
                <span
                  aria-hidden
                  className="mt-0.5 w-1.5 shrink-0"
                  style={{ background: ALERT_COLORS[city.alertLevel] }}
                />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[17px] font-semibold">{city.name}</span>
                    <span className="text-[14px] text-ink-faint">{city.department}</span>
                    <span
                      className="stamp"
                      style={{ color: ALERT_COLORS[city.alertLevel] }}
                    >
                      alerta {city.alertLevel.toLowerCase()}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[15px] leading-snug text-ink-soft">{city.notes}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Lo que ha pasado dentro de esta plataforma, separado de lo oficial. */}
      {data && (
        <section className="mx-auto max-w-5xl px-4 pb-4">
          <h2 className="text-[19px] font-bold tracking-tight">En esta plataforma</h2>
          <p className="mt-1 text-[15px] text-ink-soft">
            Reportes hechos por la comunidad. No son cifras oficiales.
          </p>

          <dl className="num mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <PlatformStat value={data.plataforma.activos} label="búsquedas abiertas" />
            <PlatformStat
              value={data.plataforma.encontradosConVida}
              label="localizados con vida"
              accent="var(--color-via)"
            />
            <PlatformStat
              value={data.plataforma.avistamientosAbiertos}
              label="avistamientos sin cruzar"
            />
            <PlatformStat value={data.plataforma.totalReportes} label="reportes en total" />
          </dl>
        </section>
      )}

      {!data && (
        <section className="mx-auto max-w-5xl px-4 pb-10">
          <div
            className="border-l-4 px-4 py-3"
            style={{ borderColor: 'var(--color-naranja)', background: 'var(--color-paper-sunk)' }}
          >
            <p className="font-semibold">No se pudo cargar la información del evento.</p>
            <p className="mt-1 text-[15px] text-ink-soft">
              Puedes seguir reportando: lo que guardes queda en este teléfono y se envía cuando
              vuelva la conexión.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

function Spec({ label, value, dark = false }: { label: string; value: string; dark?: boolean }) {
  return (
    <div>
      <dt className="eyebrow" style={{ color: dark ? undefined : 'var(--color-rule)' }}>
        {label}
      </dt>
      <dd className="mt-0.5 font-semibold">{value}</dd>
    </div>
  );
}

function BigAction({
  href,
  title,
  detail,
  accent,
}: {
  href: string;
  title: string;
  detail: string;
  accent: string;
}) {
  return (
    <Link
      href={href}
      className="group block border-2 border-ink bg-paper p-4 transition-colors hover:bg-ink hover:text-paper"
    >
      <span aria-hidden className="mb-3 block h-1.5 w-10" style={{ background: accent }} />
      <span className="block text-[20px] font-bold leading-tight tracking-tight">{title}</span>
      <span className="mt-1 block text-[15px] leading-snug text-ink-soft group-hover:text-paper/80">
        {detail}
      </span>
    </Link>
  );
}

function Figure({
  value,
  label,
  accent,
  emphasis = false,
}: {
  value: number;
  label: string;
  accent?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="border-b border-r border-rule px-4 py-4 last:border-r-0 sm:border-b-0">
      <dd
        className="num text-[clamp(1.7rem,6vw,2.4rem)] font-bold leading-none tracking-tight"
        style={{ color: accent }}
      >
        {value.toLocaleString('es-CO')}
      </dd>
      <dt
        className={`mt-1.5 text-[14px] ${emphasis ? 'font-semibold text-ink' : 'text-ink-soft'}`}
      >
        {label}
      </dt>
    </div>
  );
}

function PlatformStat({
  value,
  label,
  accent,
}: {
  value: number;
  label: string;
  accent?: string;
}) {
  return (
    <div>
      <dd
        className="text-[26px] font-bold leading-none tracking-tight"
        style={{ color: accent }}
      >
        {value.toLocaleString('es-CO')}
      </dd>
      <dt className="mt-1 text-[14px] leading-snug text-ink-soft">{label}</dt>
    </div>
  );
}
