'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  api,
  submit,
  type AreaContext,
  type CoverageView,
  type DamageView,
  type IngestStatus,
  type MunicipalityAggregate,
  type RoadView,
  type SeismicView,
  type ZoneType,
  type ZoneView,
} from '@/lib/api';
import { MapLegend } from '@/components/MapLegend';
import { RoadNamePicker } from '@/components/RoadNamePicker';
import { AftershockDetail, DamageDetail, MunicipalityDetail } from '@/components/MapDetails';
import { getCachedZones, cacheZones } from '@/lib/outbox';
import { getDeviceId } from '@/lib/device';
import { LAYER_LABELS, zoneColor } from '@/lib/zone-style';
import { DecayMeter, timeAgo } from '@/components/DecayMeter';

// MapLibre toca `window` al importarse, así que no puede renderizarse en el
// servidor.
const MapView = dynamic(() => import('@/components/MapView').then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-paper-sunk">
      <p className="eyebrow">Cargando mapa…</p>
    </div>
  ),
});

type Layer = 'ROAD' | 'HAZARD' | 'RESOURCE' | 'SERVICE';
const ALL_LAYERS: Layer[] = ['ROAD', 'HAZARD', 'RESOURCE', 'SERVICE'];

/**
 * Las capas de fuentes externas se manejan aparte de las de la comunidad.
 *
 * No son reportes: nadie las confirma ni las refuta, no decaen con el tiempo y
 * su autoridad viene de otro lado. Mezclarlas en el mismo conmutador daría a
 * entender que son lo mismo que un aviso de un vecino.
 */
type ExternalLayer = 'SEISMIC' | 'DAMAGE' | 'MUNICIPALITY' | 'ROADS';

/**
 * Qué está mirando el usuario en el panel derecho.
 *
 * Una unión discriminada en vez de cuatro estados sueltos: garantiza que sólo
 * haya una selección viva a la vez y que el panel no pueda quedar mostrando un
 * detalle de un elemento que ya se deseleccionó.
 */
type Selection =
  | { kind: 'zone'; zone: ZoneView }
  | { kind: 'aftershock'; event: SeismicView }
  | { kind: 'damage'; building: DamageView }
  | { kind: 'municipality'; item: MunicipalityAggregate }
  | null;

export default function MapaPage() {
  return (
    <Suspense fallback={<div className="p-4 text-[16px] text-ink-soft">Cargando el mapa…</div>}>
      <Mapa />
    </Suspense>
  );
}

function Mapa() {
  // La emergencia consultada viaja en la URL para que el enlace se pueda
  // compartir. Sin parámetro, la que esté en curso.
  const emergencia = useSearchParams().get('emergencia') ?? undefined;
  const q = emergencia ? `&evento=${encodeURIComponent(emergencia)}` : '';
  const soloConsulta = Boolean(emergencia);

  const [zones, setZones] = useState<ZoneView[]>([]);
  const [types, setTypes] = useState<ZoneType[]>([]);
  const [aftershocks, setAftershocks] = useState<SeismicView[]>([]);
  const [damage, setDamage] = useState<DamageView[]>([]);
  const [coverage, setCoverage] = useState<CoverageView[]>([]);
  const [aggregates, setAggregates] = useState<MunicipalityAggregate[]>([]);
  const [roads, setRoads] = useState<RoadView[]>([]);
  const [freshness, setFreshness] = useState<IngestStatus | null>(null);
  const [bbox, setBbox] = useState<string | null>(null);
  const [activeLayers, setActiveLayers] = useState<Layer[]>(ALL_LAYERS);
  const [externalLayers, setExternalLayers] = useState<ExternalLayer[]>([
    'SEISMIC',
    'DAMAGE',
    'MUNICIPALITY',
  ]);
  const [selected, setSelected] = useState<Selection>(null);
  const [fromCache, setFromCache] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [pendingMarker, setPendingMarker] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [zonesResponse, typesResponse] = await Promise.all([
        api.get<{ items: ZoneView[] }>(`/mapa/reportes?limit=800${q}`),
        api.get<{ items: ZoneType[] }>('/mapa/tipos'),
      ]);
      setZones(zonesResponse.items);
      setTypes(typesResponse.items);
      setFromCache(false);
      void cacheZones(zonesResponse.items as unknown as { id: string; revision: string }[]);
    } catch {
      // Sin red se pinta lo último descargado. El mapa sigue siendo útil —es
      // el caso de uso central en las zonas sin cobertura— pero la interfaz
      // avisa de que puede estar vencido en lugar de fingir que está al día.
      const cached = (await getCachedZones()) as ZoneView[];
      if (cached.length) {
        setZones(cached);
        setFromCache(true);
      }
    }
  }, []);

  /**
   * Las fuentes externas se cargan por separado y sin bloquear el mapa. Si el
   * USGS o HDX no responden, el mapa colaborativo —que es lo que salva vidas
   * ahora mismo— tiene que pintarse igual.
   */
  const loadExternal = useCallback(async () => {
    try {
      const quakes = await api.get<{ items: SeismicView[] }>(`/sismos/replicas?limit=500${q}`);
      setAftershocks(quakes.items);
    } catch {
      /* sin réplicas: el resto del mapa sigue en pie */
    }
    try {
      const buildings = await api.get<{ items: DamageView[] }>(`/danos?limit=2000${q}`);
      setDamage(buildings.items);
    } catch {
      /* sin capa de daño: el resto del mapa sigue en pie */
    }
    try {
      // Dónde se ha mirado. Se carga siempre que se carga el daño: sin ella el
      // mapa no puede distinguir "sin daño" de "sin evaluar".
      const areas = await api.get<{ items: CoverageView[] }>(`/danos/cobertura${q ? '?' + q.slice(1) : ''}`);
      setCoverage(areas.items);
    } catch {
      /* sin cobertura: se advierte igual en la leyenda */
    }
    try {
      const summary = await api.get<{ items: MunicipalityAggregate[] }>('/mapa/agregado');
      setAggregates(summary.items);
    } catch {
      /* sin agregados: quedan los reportes individuales */
    }
    try {
      // Cuándo se actualizó cada capa externa. Un dato de terceros sin fecha de
      // carga es un dato en el que no se puede confiar.
      setFreshness(await api.get<IngestStatus>('/ingesta/estado'));
    } catch {
      /* sin estado de ingesta: las capas se muestran sin fecha */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadExternal();
  }, [load, loadExternal]);

  /**
   * La red vial se recarga al mover el mapa, no una sola vez: son 161.000
   * tramos y traerlos todos sería inservible. El servidor decide el nivel de
   * detalle a partir del tamaño de la ventana.
   */
  useEffect(() => {
    if (!externalLayers.includes('ROADS') || !bbox) {
      setRoads([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .get<{ items: RoadView[] }>(`/vias?bbox=${encodeURIComponent(bbox)}&limit=3000`)
        .then((response) => setRoads(response.items))
        .catch(() => setRoads([]));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [bbox, externalLayers]);

  const visible = useMemo(
    () => zones.filter((zone) => activeLayers.includes(zone.layer)),
    [zones, activeLayers],
  );

  const toggleLayer = (layer: Layer) =>
    setActiveLayers((current) =>
      current.includes(layer) ? current.filter((l) => l !== layer) : [...current, layer],
    );

  const toggleExternal = (layer: ExternalLayer) =>
    setExternalLayers((current) =>
      current.includes(layer) ? current.filter((l) => l !== layer) : [...current, layer],
    );

  return (
    <div className="lg:grid lg:h-[calc(100vh-116px)] lg:grid-cols-[1fr_400px]">
      <div className="relative h-[58vh] lg:h-auto">
        <MapView
          zones={visible}
          aftershocks={externalLayers.includes('SEISMIC') ? aftershocks : []}
          damage={externalLayers.includes('DAMAGE') ? damage : []}
          coverage={externalLayers.includes('DAMAGE') ? coverage : []}
          aggregates={externalLayers.includes('MUNICIPALITY') ? aggregates : []}
          roads={roads}
          onBoundsChange={setBbox}
          selectedId={selected?.kind === 'zone' ? selected.zone.id : null}
          onSelect={(zone) => setSelected(zone ? { kind: 'zone', zone } : null)}
          onSelectAftershock={(event) => setSelected({ kind: 'aftershock', event })}
          onSelectDamage={(building) => setSelected({ kind: 'damage', building })}
          onSelectMunicipality={(item) => setSelected({ kind: 'municipality', item })}
          placing={placing}
          onPlace={(coords) => {
            setPendingMarker(coords);
            setPlacing(false);
          }}
          pendingMarker={pendingMarker}
        />

        {placing && (
          <div className="pointer-events-none absolute inset-x-0 top-0 bg-ink px-4 py-2.5 text-center text-[15px] font-medium text-paper">
            Toca el punto exacto en el mapa
          </div>
        )}

        {fromCache && !placing && (
          <div
            className="absolute inset-x-0 top-0 px-4 py-2.5 text-center text-[14px] font-medium"
            style={{ background: 'var(--color-naranja)', color: 'var(--color-paper)' }}
          >
            Sin conexión · estás viendo la última copia descargada
          </div>
        )}
      </div>

      <aside className="rule overflow-y-auto lg:border-l lg:border-t-0">
        {selected?.kind === 'zone' ? (
          <ZoneDetail zone={selected.zone} onBack={() => setSelected(null)} onChanged={load} />
        ) : selected?.kind === 'aftershock' ? (
          <AftershockDetail event={selected.event} onBack={() => setSelected(null)} />
        ) : selected?.kind === 'damage' ? (
          <DamageDetail building={selected.building} onBack={() => setSelected(null)} />
        ) : selected?.kind === 'municipality' ? (
          <MunicipalityDetail item={selected.item} onBack={() => setSelected(null)} />
        ) : (
          <MapPanel
            soloConsulta={soloConsulta}
            zones={visible}
            types={types}
            activeLayers={activeLayers}
            onToggleLayer={toggleLayer}
            externalLayers={externalLayers}
            onToggleExternal={toggleExternal}
            aftershockCount={aftershocks.length}
            damageCount={damage.length}
            aggregates={aggregates}
            roadCount={roads.length}
            freshness={freshness}
            latestAftershock={aftershocks.find((a) => !a.isMainshock) ?? null}
            onSelect={(zone) => setSelected({ kind: 'zone', zone })}
            onSelectMunicipality={(item) => setSelected({ kind: 'municipality', item })}
            placing={placing}
            pendingMarker={pendingMarker}
            onStartPlacing={() => {
              setPendingMarker(null);
              setPlacing(true);
            }}
            onCancelPlacing={() => {
              setPlacing(false);
              setPendingMarker(null);
            }}
            onCreated={() => {
              setPendingMarker(null);
              void load();
            }}
          />
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MapPanel({
  zones,
  types,
  activeLayers,
  onToggleLayer,
  externalLayers,
  onToggleExternal,
  aftershockCount,
  damageCount,
  aggregates,
  roadCount,
  freshness,
  latestAftershock,
  onSelect,
  onSelectMunicipality,
  placing,
  pendingMarker,
  onStartPlacing,
  onCancelPlacing,
  onCreated,
  /** Se está mirando una emergencia que ya no está en curso. */
  soloConsulta,
}: {
  zones: ZoneView[];
  types: ZoneType[];
  activeLayers: Layer[];
  onToggleLayer: (layer: Layer) => void;
  externalLayers: ExternalLayer[];
  onToggleExternal: (layer: ExternalLayer) => void;
  aftershockCount: number;
  damageCount: number;
  aggregates: MunicipalityAggregate[];
  roadCount: number;
  freshness: IngestStatus | null;
  latestAftershock: SeismicView | null;
  onSelect: (zone: ZoneView) => void;
  onSelectMunicipality: (item: MunicipalityAggregate) => void;
  placing: boolean;
  pendingMarker: { latitude: number; longitude: number } | null;
  onStartPlacing: () => void;
  onCancelPlacing: () => void;
  onCreated: () => void;
  /** Se está consultando una emergencia que ya no está en curso. */
  soloConsulta: boolean;
}) {
  if (pendingMarker) {
    return (
      <NewZoneForm
        types={types}
        coords={pendingMarker}
        onCancel={onCancelPlacing}
        onCreated={onCreated}
      />
    );
  }

  return (
    <div className="p-4">
      {/* En modo consulta no se ofrece reportar. El servidor atribuye todo
          reporte nuevo a la emergencia en curso, así que el botón prometería
          algo que no ocurre: la persona cree que describe lo que está viendo y
          el reporte acaba en otra emergencia, quizá a mil kilómetros. */}
      {soloConsulta ? (
        <p
          className="border-l-4 px-3 py-2 text-[15px] leading-snug"
          style={{ borderColor: 'var(--color-naranja)' }}
        >
          Estás consultando una emergencia anterior. Para reportar algo, vuelve al mapa de la
          emergencia en curso.
        </p>
      ) : (
        <button
          type="button"
          onClick={placing ? onCancelPlacing : onStartPlacing}
          className="target w-full justify-center bg-ink px-4 text-[17px] font-semibold text-paper"
        >
          {placing ? 'Cancelar' : 'Reportar algo en el mapa'}
        </button>
      )}

      {/* La leyenda va primero: sin ella el mapa es un campo de colores que hay
          que descifrar, y descifrarlo no es lo que alguien viene a hacer aquí. */}
      <div className="mt-5">
        <MapLegend />
      </div>

      {/* Municipios ordenados por atención. Es la lectura que responde "por
          dónde empiezo", que ninguna cantidad de pines sueltos responde. */}
      {aggregates.length > 0 && (
        <section className="mt-6">
          <h2 className="eyebrow">Municipios por atender</h2>
          <ul className="mt-2">
            {aggregates.slice(0, 12).map((item) => (
              <li key={`${item.municipality}-${item.department}`} className="rule">
                <button
                  type="button"
                  onClick={() => onSelectMunicipality(item)}
                  className="w-full py-2.5 text-left hover:bg-paper-sunk"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-[16px] font-semibold leading-tight">
                      {item.municipality}
                    </span>
                    <span className="num text-[12px] text-ink-faint">{item.department}</span>
                  </span>

                  {/* Cada cifra con su unidad y su color, los mismos del mapa. */}
                  <span className="num mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px]">
                    {item.desaparecidos.activos > 0 && (
                      <span style={{ color: 'var(--color-roja)' }}>
                        {item.desaparecidos.activos} sin localizar
                      </span>
                    )}
                    {item.zonas.viasBloqueadas > 0 && (
                      <span style={{ color: 'var(--color-naranja)' }}>
                        {item.zonas.viasBloqueadas} vías cortadas
                      </span>
                    )}
                    {item.danos.edificaciones > 0 && (
                      <span style={{ color: '#8B2E24' }}>
                        {item.danos.edificaciones.toLocaleString('es-CO')} edificaciones
                      </span>
                    )}
                    {item.replicas.conteo > 0 && (
                      <span style={{ color: 'var(--color-signal)' }}>
                        {item.replicas.conteo} réplicas
                      </span>
                    )}
                    {item.zonas.total > 0 && (
                      <span className="text-ink-faint">{item.zonas.total} reportes</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="eyebrow">Capas</h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {ALL_LAYERS.map((layer) => {
            const active = activeLayers.includes(layer);
            return (
              <li key={layer}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onToggleLayer(layer)}
                  className={`border-2 px-3 py-2 text-[15px] font-medium ${
                    active ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-faint'
                  }`}
                >
                  {LAYER_LABELS[layer]}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Fuentes externas, separadas de los reportes de la comunidad. Nadie las
          confirma ni las refuta y su autoridad viene de otro lado: presentarlas
          en el mismo bloque sugeriría que son la misma clase de información. */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="eyebrow">Fuentes externas</h2>
          {freshness && <FreshnessNote status={freshness} />}
        </div>

        <ul className="mt-2 space-y-2">
          <li>
            <button
              type="button"
              aria-pressed={externalLayers.includes('MUNICIPALITY')}
              onClick={() => onToggleExternal('MUNICIPALITY')}
              className={`w-full border-2 px-3 py-2.5 text-left ${
                externalLayers.includes('MUNICIPALITY') ? 'border-ink' : 'border-rule opacity-55'
              }`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[16px] font-semibold">Resumen por municipio</span>
                <span className="num text-[13px] text-ink-faint">{aggregates.length}</span>
              </span>
              <span className="mt-0.5 block text-[13px] leading-snug text-ink-faint">
                Cruza personas sin localizar, vías cortadas, daño en edificaciones y réplicas
                en un solo recuadro. Las personas se muestran agregadas, nunca como puntos
                individuales.
              </span>
            </button>
          </li>

          <li>
            <button
              type="button"
              aria-pressed={externalLayers.includes('ROADS')}
              onClick={() => onToggleExternal('ROADS')}
              className={`w-full border-2 px-3 py-2.5 text-left ${
                externalLayers.includes('ROADS') ? 'border-ink' : 'border-rule opacity-55'
              }`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[16px] font-semibold">Red vial</span>
                <span className="num text-[13px] text-ink-faint">{roadCount || '—'}</span>
              </span>
              <span className="mt-0.5 block text-[13px] leading-snug text-ink-faint">
                70.507 km mapeados por la comunidad humanitaria (HOT/OpenStreetMap, 13 ago),
                incluidos 8.901 km en Chocó. Muestra qué vías existen, no cuáles están
                transitables. Discontinua = sin pavimentar.
              </span>
            </button>
          </li>

          <li>
            <button
              type="button"
              aria-pressed={externalLayers.includes('SEISMIC')}
              onClick={() => onToggleExternal('SEISMIC')}
              className={`w-full border-2 px-3 py-2.5 text-left ${
                externalLayers.includes('SEISMIC') ? 'border-ink' : 'border-rule opacity-55'
              }`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[16px] font-semibold">Réplicas</span>
                <span className="num text-[13px] text-ink-faint">{aftershockCount}</span>
              </span>
              <span className="mt-0.5 block text-[13px] leading-snug text-ink-faint">
                Catálogo del USGS.{' '}
                {latestAftershock
                  ? `Última: M${latestAftershock.magnitude} ${timeAgo(latestAftershock.occurredAt)}.`
                  : ''}{' '}
                La red del SGC es más densa y reporta más réplicas de las que
                detecta la red global.
              </span>
            </button>
          </li>

          <li>
            <button
              type="button"
              aria-pressed={externalLayers.includes('DAMAGE')}
              onClick={() => onToggleExternal('DAMAGE')}
              className={`w-full border-2 px-3 py-2.5 text-left ${
                externalLayers.includes('DAMAGE') ? 'border-ink' : 'border-rule opacity-55'
              }`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[16px] font-semibold">Daño en edificaciones</span>
                <span className="num text-[13px] text-ink-faint">{damageCount}</span>
              </span>
              <span className="mt-0.5 block text-[13px] leading-snug text-ink-faint">
                Estimación de un modelo sobre imagen satelital (Microsoft AI for Good,
                vía HDX). Solo hay evaluación publicada para Cali y Pereira; el borde
                discontinuo marca hasta dónde se miró. Fuera de ahí, incluido el Chocó,
                nadie ha medido el daño.
              </span>
            </button>
          </li>
        </ul>
      </section>

      <section className="mt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="eyebrow">Reportes de la comunidad</h2>
          <span className="num text-[13px] text-ink-faint">{zones.length}</span>
        </div>

        {zones.length === 0 ? (
          <p className="mt-3 text-[15px] text-ink-soft">
            No hay reportes activos en estas capas. Si sabes de una vía cortada o de un punto
            de ayuda, repórtalo: es lo que hace útil el mapa para el resto.
          </p>
        ) : (
          <ul className="mt-2">
            {zones.map((zone) => (
              <li key={zone.id} className="rule">
                <button
                  type="button"
                  onClick={() => onSelect(zone)}
                  className="w-full py-3 text-left hover:bg-paper-sunk"
                >
                  <span className="flex items-baseline gap-2">
                    <span
                      aria-hidden
                      className="mt-1.5 h-2.5 w-2.5 shrink-0"
                      style={{ background: zoneColor(zone.type) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[16px] font-semibold leading-tight">
                        {zone.label}
                      </span>
                      <span className="mt-0.5 block text-[14px] leading-snug text-ink-soft">
                        {[zone.roadName, zone.municipality].filter(Boolean).join(' · ') ||
                          'Sin ubicación descrita'}
                      </span>
                    </span>
                  </span>
                  <span className="mt-2 block">
                    <DecayMeter
                      confidence={zone.confidence}
                      lastConfirmedAt={zone.lastConfirmedAt}
                      confirmations={zone.confirmations}
                      refutations={zone.refutations}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ZoneDetail({
  zone,
  onBack,
  onChanged,
}: {
  zone: ZoneView;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [context, setContext] = useState<AreaContext | null>(null);

  // Qué más hay alrededor. Sin esto cada pin es un dato aislado y el mapa no
  // ayuda a decidir nada: saber que hay un derrumbe importa distinto si a dos
  // kilómetros hay cinco personas sin localizar.
  useEffect(() => {
    setContext(null);
    api
      .get<AreaContext>(
        `/mapa/contexto?lat=${zone.location.latitude}&lon=${zone.location.longitude}&radiusMeters=5000`,
      )
      .then(setContext)
      .catch(() => setContext(null));
  }, [zone.id, zone.location.latitude, zone.location.longitude]);

  const vote = async (kind: 'CONFIRM' | 'REFUTE') => {
    setBusy(true);
    setMessage(null);
    try {
      const { queued } = await submit({
        path: `/mapa/reportes/${zone.id}/voto`,
        type: 'ZONE_VOTE',
        clientUuid: crypto.randomUUID(),
        targetId: zone.id,
        payload: {
          clientUuid: crypto.randomUUID(),
          vote: kind,
          deviceId: getDeviceId(),
        },
        label: `${kind === 'CONFIRM' ? 'Confirmación' : 'Refutación'} · ${zone.label}`,
      });

      setMessage(
        queued
          ? 'Guardado en este teléfono. Se envía cuando vuelva la señal.'
          : kind === 'CONFIRM'
            ? 'Gracias. El reporte vuelve a contar como reciente.'
            : 'Gracias. El reporte pierde confianza en el mapa.',
      );
      if (!queued) onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo registrar tu respuesta.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4">
      <button
        type="button"
        onClick={onBack}
        className="text-[15px] font-medium underline underline-offset-4"
      >
        ← Volver a la lista
      </button>

      <span
        aria-hidden
        className="mt-4 block h-1.5 w-12"
        style={{ background: zoneColor(zone.type) }}
      />
      <h2 className="mt-3 text-[24px] font-bold leading-tight tracking-tight">{zone.label}</h2>

      <p className="num mt-1 text-[13px] text-ink-faint">
        {[zone.roadName, zone.municipality, zone.department].filter(Boolean).join(' · ')}
      </p>

      {zone.description && (
        <p className="mt-3 text-[16px] leading-snug">{zone.description}</p>
      )}

      <div className="mt-5">
        <p className="eyebrow">Qué tan confiable es</p>
        <div className="mt-2">
          <DecayMeter
            confidence={zone.confidence}
            lastConfirmedAt={zone.lastConfirmedAt}
            confirmations={zone.confirmations}
            refutations={zone.refutations}
          />
        </div>
        <p className="mt-2 text-[14px] leading-snug text-ink-soft">
          Reportado {timeAgo(zone.reportedAt)} por{' '}
          {zone.reporterOrganization ?? roleLabel(zone.reporterRole)}. La confianza baja sola
          con el tiempo hasta que alguien vuelva a confirmarlo.
        </p>
      </div>

      <div className="mt-5">
        <p className="eyebrow">¿Sigue siendo así?</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => vote('CONFIRM')}
            className="target justify-center px-3 text-[16px] font-semibold text-paper disabled:opacity-60"
            style={{ background: 'var(--color-via)' }}
          >
            Sí, sigue así
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => vote('REFUTE')}
            className="target justify-center px-3 text-[16px] font-semibold text-paper disabled:opacity-60"
            style={{ background: 'var(--color-roja)' }}
          >
            Ya no
          </button>
        </div>
        {message && (
          <p role="status" className="mt-3 text-[15px] font-medium">
            {message}
          </p>
        )}
      </div>

      {context && (
        <div className="rule mt-6 pt-5">
          <p className="eyebrow">A 5 km a la redonda</p>

          <ul className="num mt-2 space-y-1.5 text-[15px]">
            {context.desaparecidos.activos > 0 && (
              <li className="flex items-baseline justify-between gap-3">
                <span style={{ color: 'var(--color-roja)' }}>
                  {context.desaparecidos.activos}{' '}
                  {context.desaparecidos.activos === 1 ? 'persona' : 'personas'} sin localizar
                </span>
                {context.desaparecidos.menores > 0 && (
                  <span className="text-[13px] text-ink-faint">
                    {context.desaparecidos.menores} menores
                  </span>
                )}
              </li>
            )}
            {context.avistamientos > 0 && (
              <li>{context.avistamientos} avistamientos sin cruzar</li>
            )}
            {context.zonas.viasBloqueadas > 0 && (
              <li style={{ color: 'var(--color-naranja)' }}>
                {context.zonas.viasBloqueadas}{' '}
                {context.zonas.viasBloqueadas === 1 ? 'vía cortada' : 'vías cortadas'}
              </li>
            )}
            {context.zonas.recursos > 0 && (
              <li style={{ color: 'var(--color-via)' }}>
                {context.zonas.recursos} puntos de ayuda
              </li>
            )}
            {context.danos > 0 && (
              <li style={{ color: '#8B2E24' }}>
                {context.danos.toLocaleString('es-CO')} edificaciones con daño estimado
              </li>
            )}
            {context.replicas.conteo > 0 && (
              <li style={{ color: 'var(--color-signal)' }}>
                {context.replicas.conteo} réplicas
                {context.replicas.magnitudMaxima !== null &&
                  ` · la mayor, M ${context.replicas.magnitudMaxima}`}
              </li>
            )}
          </ul>

          {context.desaparecidos.activos === 0 &&
            context.avistamientos === 0 &&
            context.zonas.viasBloqueadas === 0 &&
            context.zonas.recursos === 0 &&
            context.danos === 0 &&
            context.replicas.conteo === 0 && (
              <p className="mt-1 text-[15px] text-ink-soft">
                No hay nada más reportado en este radio.
              </p>
            )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function NewZoneForm({
  types,
  coords,
  onCancel,
  onCreated,
}: {
  types: ZoneType[];
  coords: { latitude: number; longitude: number };
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState('');
  const [description, setDescription] = useState('');
  const [roadName, setRoadName] = useState('');
  const [role, setRole] = useState('CITIZEN');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, ZoneType[]>();
    for (const t of types) {
      map.set(t.layer, [...(map.get(t.layer) ?? []), t]);
    }
    return [...map.entries()];
  }, [types]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!type) return;

    setBusy(true);
    setMessage(null);
    const clientUuid = crypto.randomUUID();

    try {
      const { queued } = await submit({
        path: '/mapa/reportes',
        type: 'ZONE_REPORT',
        clientUuid,
        payload: {
          clientUuid,
          type,
          location: coords,
          description: description || undefined,
          roadName: roadName || undefined,
          reporterRole: role,
          deviceId: getDeviceId(),
          // La hora de observación, no la del envío: si esto se sincroniza
          // dentro de seis horas, el reporte debe nacer con seis horas de
          // antigüedad, no fresco.
          reportedAt: new Date().toISOString(),
        },
        label: `${types.find((t) => t.type === type)?.label ?? 'Reporte'} en el mapa`,
      });

      setMessage(
        queued
          ? 'Guardado en este teléfono. Se publica en el mapa cuando vuelva la señal.'
          : 'Publicado. Gracias: esto le sirve a quien venga detrás.',
      );
      setType('');
      setDescription('');
      setRoadName('');
      window.setTimeout(onCreated, 1200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo publicar el reporte.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={send} className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[20px] font-bold tracking-tight">Nuevo reporte</h2>
        <button type="button" onClick={onCancel} className="text-[15px] underline underline-offset-4">
          Cancelar
        </button>
      </div>

      <p className="num mt-1 text-[13px] text-ink-faint">
        {coords.latitude.toFixed(5)} N {Math.abs(coords.longitude).toFixed(5)} W
      </p>

      <fieldset className="mt-5">
        <legend className="eyebrow">Qué estás reportando</legend>
        {grouped.map(([layer, items]) => (
          <div key={layer} className="mt-3">
            <p className="text-[13px] font-semibold text-ink-soft">{LAYER_LABELS[layer]}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {items.map((item) => (
                <label
                  key={item.type}
                  className={`cursor-pointer border-2 px-3 py-2 text-[15px] ${
                    type === item.type ? 'border-ink bg-ink text-paper' : 'border-rule'
                  }`}
                >
                  <input
                    type="radio"
                    name="tipo"
                    value={item.type}
                    checked={type === item.type}
                    onChange={() => setType(item.type)}
                    className="sr-only"
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>

      <RoadNamePicker coords={coords} value={roadName} onChange={setRoadName} />

      <Field label="Qué viste" hint="Opcional">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={2000}
          className="w-full border-2 border-rule bg-paper px-3 py-2.5 text-[16px] focus:border-ink"
        />
      </Field>

      <Field label="Reportas como" hint="Un reporte oficial pesa más en el mapa">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full border-2 border-rule bg-paper px-3 py-2.5 text-[16px] focus:border-ink"
        >
          <option value="CITIZEN">Ciudadano</option>
          <option value="VOLUNTEER">Voluntario</option>
          <option value="RESCUER">Organismo de socorro</option>
          <option value="HEALTH_STAFF">Personal de salud</option>
          <option value="OFFICIAL">Entidad oficial</option>
        </select>
      </Field>

      <button
        type="submit"
        disabled={busy || !type}
        className="target mt-5 w-full justify-center bg-ink px-4 text-[17px] font-semibold text-paper disabled:opacity-40"
      >
        {busy ? 'Publicando…' : 'Publicar en el mapa'}
      </button>

      {message && (
        <p role="status" className="mt-3 text-[15px] font-medium">
          {message}
        </p>
      )}
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-4 block">
      <span className="block text-[15px] font-semibold">{label}</span>
      {hint && <span className="mb-1.5 block text-[13px] text-ink-faint">{hint}</span>}
      {children}
    </label>
  );
}

/**
 * Cuándo se actualizaron las capas externas.
 *
 * Va discreta, junto al encabezado de la sección y no como aviso: es contexto
 * permanente, no una alerta. Pero tiene que estar — una capa de terceros sin
 * fecha de carga invita a confiar en ella más de lo que merece, y si una
 * ingesta lleva días fallando, el mapa parecería al día sin estarlo.
 */
function FreshnessNote({ status }: { status: IngestStatus }) {
  const latest = status.fuentes
    .map((f) => f.ultimaCargaExitosa)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);

  const failing = status.fuentes.some((f) => f.ultimoIntento?.estado === 'FAILED');

  if (failing) {
    return (
      <span className="num text-[12px]" style={{ color: 'var(--color-naranja)' }}>
        última carga falló
      </span>
    );
  }

  if (!latest) {
    return <span className="num text-[12px] text-ink-faint">sin cargar</span>;
  }

  return (
    <span className="num text-[12px] text-ink-faint">actualizado {timeAgo(latest)}</span>
  );
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    CITIZEN: 'un ciudadano',
    VOLUNTEER: 'un voluntario',
    RESCUER: 'un organismo de socorro',
    HEALTH_STAFF: 'personal de salud',
    OFFICIAL: 'una entidad oficial',
    FAMILY: 'un familiar',
  };
  return labels[role] ?? 'alguien';
}
