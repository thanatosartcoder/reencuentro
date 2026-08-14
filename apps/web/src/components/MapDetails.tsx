'use client';

import type { DamageView, MunicipalityAggregate, SeismicView } from '@/lib/api';
import { timeAgo } from '@/components/DecayMeter';
import { NARANJA, ROJA, SIGNAL, VIA } from '@/lib/zone-style';

/**
 * Paneles de detalle de los elementos del mapa que no son reportes de la
 * comunidad. Todos comparten la misma estructura: qué es, de dónde salió el
 * dato, y qué NO significa. Lo último es lo que evita que una estimación se lea
 * como un hecho verificado.
 */

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="text-[15px] font-medium underline underline-offset-4"
    >
      ← Volver a la lista
    </button>
  );
}

function Stat({
  value,
  label,
  color,
  hint,
}: {
  value: string | number;
  label: string;
  color?: string;
  hint?: string;
}) {
  return (
    <div>
      <p
        className="num text-[24px] font-bold leading-none tracking-tight"
        style={color ? { color } : undefined}
      >
        {typeof value === 'number' ? value.toLocaleString('es-CO') : value}
      </p>
      <p className="mt-1 text-[13px] leading-snug text-ink-soft">{label}</p>
      {hint && <p className="text-[12px] leading-snug text-ink-faint">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function AftershockDetail({
  event,
  onBack,
}: {
  event: SeismicView;
  onBack: () => void;
}) {
  return (
    <div className="p-4">
      <BackLink onBack={onBack} />

      <span
        aria-hidden
        className="mt-4 block h-1.5 w-12"
        style={{ background: event.isMainshock ? '#12161c' : '#7a3fb0' }}
      />

      <p className="eyebrow mt-3">{event.isMainshock ? 'Sismo principal' : 'Réplica'}</p>
      <h2 className="num mt-1 text-[32px] font-bold leading-none tracking-tight">
        M {event.magnitude}
        {event.magnitudeType && (
          <span className="ml-2 text-[14px] font-normal text-ink-faint">
            {event.magnitudeType}
          </span>
        )}
      </h2>

      <p className="mt-2 text-[16px] leading-snug">{event.place}</p>

      <dl className="num mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-[14px]">
        <div>
          <dt className="eyebrow">Cuándo</dt>
          <dd className="mt-0.5">
            {new Date(event.occurredAt).toLocaleString('es-CO', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </dd>
          <dd className="text-ink-faint">{timeAgo(event.occurredAt)}</dd>
        </div>
        <div>
          <dt className="eyebrow">Profundidad</dt>
          <dd className="mt-0.5">{event.depthKm?.toFixed(1) ?? '—'} km</dd>
          {/* La profundidad explica por qué un sismo de esta magnitud no arrasó
              la superficie sobre el epicentro: a 110 km la energía llega
              repartida sobre un área mucho mayor. */}
          <dd className="text-[12px] leading-snug text-ink-faint">
            {(event.depthKm ?? 0) > 70 ? 'Sismo profundo' : 'Sismo superficial'}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Coordenadas</dt>
          <dd className="mt-0.5">
            {event.latitude.toFixed(3)} N {Math.abs(event.longitude).toFixed(3)} W
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Del epicentro</dt>
          <dd className="mt-0.5">{event.distanceToMainshockKm?.toFixed(1) ?? '—'} km</dd>
        </div>
      </dl>

      {event.communityIntensity !== null && (
        <p className="mt-4 text-[15px] leading-snug">
          Intensidad percibida reportada por la comunidad:{' '}
          <strong className="num">{event.communityIntensity}</strong>
        </p>
      )}

      <div className="rule mt-5 pt-4">
        <p className="text-[13px] leading-snug text-ink-soft">
          Solución del <strong className="text-ink">USGS</strong>. El Servicio Geológico
          Colombiano es la autoridad oficial para sismos en el país y sus cifras pueden diferir:
          su red es más densa dentro de Colombia y detecta réplicas que la red global no registra.
        </p>
        {event.detailUrl && (
          <a
            href={event.detailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-[15px] underline underline-offset-4"
          >
            Ver el evento en el USGS
          </a>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function DamageDetail({
  building,
  onBack,
}: {
  building: DamageView;
  onBack: () => void;
}) {
  const ratio = building.damageRatio ?? 0;
  const unknown = building.unknownRatio ?? 0;

  return (
    <div className="p-4">
      <BackLink onBack={onBack} />

      <span aria-hidden className="mt-4 block h-1.5 w-12" style={{ background: '#8B2E24' }} />

      <p className="eyebrow mt-3">Edificación con daño estimado</p>
      <h2 className="mt-1 text-[24px] font-bold leading-tight tracking-tight">
        {building.city}
      </h2>

      <div className="mt-5">
        <p className="eyebrow">Proporción de la huella con daño detectado</p>
        <p className="num mt-1 text-[32px] font-bold leading-none">
          {(ratio * 100).toFixed(0)}%
        </p>
        <div className="mt-2 h-2 bg-paper-sunk">
          <div
            className="h-full"
            style={{ width: `${Math.max(2, ratio * 100)}%`, background: '#8B2E24' }}
          />
        </div>
        {unknown > 0.05 && (
          <p className="mt-2 text-[13px] leading-snug text-ink-faint">
            {(unknown * 100).toFixed(0)}% de la huella no se pudo clasificar, casi siempre por
            nubes sobre la imagen.
          </p>
        )}
      </div>

      <dl className="mt-5 space-y-3 text-[14px]">
        <div>
          <dt className="eyebrow">Imagen analizada</dt>
          <dd className="mt-0.5">
            {building.imagerySource} ·{' '}
            <span className="num">{building.imageryDate?.slice(0, 10) ?? '—'}</span>
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Huella de edificación</dt>
          <dd className="mt-0.5">{building.footprintSource}</dd>
        </div>
        <div>
          <dt className="eyebrow">Publicado por</dt>
          <dd className="mt-0.5">{building.publisher}</dd>
        </div>
        <div>
          <dt className="eyebrow">Coordenadas</dt>
          <dd className="num mt-0.5">
            {building.centroid.latitude.toFixed(5)} N{' '}
            {Math.abs(building.centroid.longitude).toFixed(5)} W
          </dd>
        </div>
      </dl>

      {/* La advertencia va al final y en un bloque propio: es lo último que se
          lee antes de actuar sobre este dato. */}
      <div
        className="mt-5 border-l-4 bg-paper-sunk px-3 py-3"
        style={{ borderColor: NARANJA }}
      >
        <p className="text-[14px] font-semibold">Esto no es una inspección</p>
        <p className="mt-1 text-[14px] leading-snug text-ink-soft">
          Es la estimación de un modelo sobre una foto satelital. Sirve para decidir dónde
          mirar primero. No determina si la edificación es habitable ni reemplaza la evaluación
          de un ingeniero en sitio.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function MunicipalityDetail({
  item,
  onBack,
}: {
  item: MunicipalityAggregate;
  onBack: () => void;
}) {
  const { desaparecidos, zonas, danos, replicas, avistamientos } = item;

  return (
    <div className="p-4">
      <BackLink onBack={onBack} />

      <p className="eyebrow mt-4">Resumen del municipio</p>
      <h2 className="mt-1 text-[26px] font-bold leading-tight tracking-tight">
        {item.municipality}
      </h2>
      {item.department && <p className="text-[15px] text-ink-soft">{item.department}</p>}

      {/* Personas primero: es el objeto del sistema. */}
      <section className="mt-6">
        <h3 className="eyebrow">Personas</h3>
        <div className="mt-2 grid grid-cols-2 gap-4">
          <Stat
            value={desaparecidos.activos}
            label="sin localizar"
            color={desaparecidos.activos > 0 ? ROJA : undefined}
            hint={desaparecidos.menores > 0 ? `${desaparecidos.menores} son menores` : undefined}
          />
          <Stat
            value={desaparecidos.localizadosConVida}
            label="localizadas con vida"
            color={desaparecidos.localizadosConVida > 0 ? VIA : undefined}
          />
          <Stat value={avistamientos.abiertos} label="avistamientos sin cruzar" />
          <Stat value={desaparecidos.total} label="reportes en total" />
        </div>
      </section>

      <section className="rule mt-6 pt-5">
        <h3 className="eyebrow">Acceso y terreno</h3>
        <div className="mt-2 grid grid-cols-2 gap-4">
          <Stat
            value={zonas.viasBloqueadas}
            label="vías cortadas"
            color={zonas.viasBloqueadas > 0 ? NARANJA : undefined}
          />
          <Stat value={zonas.total} label="reportes activos" />
        </div>

        {Object.keys(zonas.porCapa).length > 0 && (
          <dl className="num mt-4 space-y-1 text-[14px]">
            {Object.entries(zonas.porCapa).map(([layer, count]) => (
              <div key={layer} className="flex justify-between gap-3">
                <dt className="text-ink-soft">{layerLabel(layer)}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="rule mt-6 pt-5">
        <h3 className="eyebrow">Fuentes externas</h3>
        <div className="mt-2 grid grid-cols-2 gap-4">
          {/* Un "0" aquí sería una mentira por omisión en la mayoría de los
              municipios: significaría "se miró y está bien" cuando lo cierto es
              que nadie ha mirado. */}
          {danos.evaluado ? (
            <Stat
              value={danos.edificaciones}
              label="edificaciones con daño estimado"
              color={danos.edificaciones > 0 ? '#8B2E24' : undefined}
              hint="satélite · no es inspección"
            />
          ) : (
            <div>
              <p className="text-[17px] font-semibold leading-tight" style={{ color: NARANJA }}>
                Sin evaluar
              </p>
              <p className="mt-1 text-[13px] leading-snug text-ink-soft">
                No hay evaluación de daño publicada para este municipio
              </p>
            </div>
          )}
          <Stat
            value={replicas.conteo}
            label="réplicas en 60 km"
            color={replicas.conteo > 0 ? SIGNAL : undefined}
            hint={
              replicas.magnitudMaxima !== null
                ? `la mayor, M ${replicas.magnitudMaxima}`
                : undefined
            }
          />
        </div>

        {!danos.evaluado && (
          <p
            className="mt-4 border-l-4 bg-paper-sunk px-3 py-2.5 text-[13px] leading-snug"
            style={{ borderColor: NARANJA }}
          >
            Solo Cali y Pereira tienen evaluación satelital publicada. Que aquí no aparezcan
            edificaciones marcadas <strong>no significa que no haya daño</strong>: significa que
            nadie lo ha medido todavía.
          </p>
        )}
      </section>

      {item.pointIsApproximate && (
        <p className="mt-6 text-[13px] leading-snug text-ink-faint">
          Los reportes de este municipio no traen coordenada —algo frecuente cuando se reporta
          sin señal y el GPS no fija—, así que el recuadro se ubicó en la cabecera municipal.
        </p>
      )}
    </div>
  );
}

function layerLabel(layer: string): string {
  return (
    {
      ROAD: 'Vías',
      HAZARD: 'Peligros',
      RESOURCE: 'Ayuda disponible',
      SERVICE: 'Servicios',
    }[layer] ?? layer
  );
}
