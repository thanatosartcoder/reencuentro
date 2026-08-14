'use client';

import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type {
  CoverageView,
  DamageView,
  MunicipalityAggregate,
  RoadView,
  SeismicView,
  ZoneView,
} from '@/lib/api';
import { NARANJA, ROJA, VIA, zoneColor } from '@/lib/zone-style';

/** Superficies que en OSM significan "sin pavimentar". */
const UNPAVED_SURFACES = new Set([
  'unpaved',
  'dirt',
  'ground',
  'earth',
  'gravel',
  'sand',
  'mud',
  'grass',
  'compacted',
  'fine_gravel',
]);

const MAP_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE ?? 'https://tiles.openfreemap.org/styles/liberty';

/** Encuadre inicial: el arco de departamentos afectados, del Chocó al Cauca. */
const INITIAL_BOUNDS: [[number, number], [number, number]] = [
  [-77.4, 2.2],
  [-74.9, 6.2],
];

export interface MapViewProps {
  zones: ZoneView[];
  /** Réplicas del catálogo del USGS. */
  aftershocks: SeismicView[];
  /** Edificaciones evaluadas como dañadas (Microsoft AI for Good vía HDX). */
  damage: DamageView[];
  /** Áreas donde existe evaluación publicada: dónde se ha mirado. */
  coverage: CoverageView[];
  /** Red vial de OpenStreetMap para la ventana visible. */
  roads: RoadView[];
  /** Resumen por municipio, dibujado como recuadros de datos y no como pines. */
  aggregates: MunicipalityAggregate[];
  selectedId: string | null;
  onSelect: (zone: ZoneView | null) => void;
  onSelectAftershock: (event: SeismicView) => void;
  onSelectDamage: (building: DamageView) => void;
  onSelectMunicipality: (municipality: MunicipalityAggregate) => void;
  /** Modo "colocar reporte": el siguiente toque en el mapa fija la ubicación. */
  placing: boolean;
  onPlace: (coords: { latitude: number; longitude: number }) => void;
  pendingMarker: { latitude: number; longitude: number } | null;
  onBoundsChange?: (bbox: string) => void;
}

export function MapView({
  zones,
  aftershocks,
  damage,
  coverage,
  roads,
  aggregates,
  selectedId,
  onSelect,
  onSelectAftershock,
  onSelectDamage,
  onSelectMunicipality,
  placing,
  onPlace,
  pendingMarker,
  onBoundsChange,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const aggregateMarkers = useRef<maplibregl.Marker[]>([]);
  const ready = useRef(false);

  // Los callbacks se guardan en refs para que el mapa se construya una sola
  // vez: recrearlo en cada render descartaría el encuadre del usuario y
  // volvería a descargar teselas, que es exactamente lo que no se puede hacer
  // en una conexión mala.
  const handlers = useRef({
    onSelect,
    onSelectAftershock,
    onSelectDamage,
    onSelectMunicipality,
    onPlace,
    onBoundsChange,
    placing,
  });
  handlers.current = {
    onSelect,
    onSelectAftershock,
    onSelectDamage,
    onSelectMunicipality,
    onPlace,
    onBoundsChange,
    placing,
  };

  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new maplibregl.Map({
      container: container.current,
      style: MAP_STYLE,
      bounds: INITIAL_BOUNDS,
      fitBoundsOptions: { padding: 32 },
      attributionControl: { compact: true },
    });
    map.current = instance;

    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'top-right',
    );
    instance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    instance.on('load', () => {
      // `damage` lleva los polígonos y `damage-centroids` los puntos: una capa
      // de tipo `circle` solo dibuja geometrías Point, así que las dos
      // representaciones de la misma edificación necesitan fuentes separadas.
      for (const id of [
        'zones',
        'paths',
        'aftershocks',
        'damage',
        'damage-centroids',
        'coverage',
        'roads',
      ] as const) {
        instance.addSource(id, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }

      // --- Área con evaluación publicada (la capa más de fondo) ---
      // Delimita dónde se ha mirado. Sin ella, una zona sin marcas de daño es
      // indistinguible de una zona intacta, y en esta emergencia esas dos
      // lecturas apuntan en direcciones opuestas: lo que no se ha evaluado es
      // justamente lo que quedó aislado.
      instance.addLayer({
        id: 'coverage-fill',
        type: 'fill',
        source: 'coverage',
        paint: { 'fill-color': '#12161c', 'fill-opacity': 0.04 },
      });
      instance.addLayer({
        id: 'coverage-outline',
        type: 'line',
        source: 'coverage',
        paint: {
          'line-color': '#12161c',
          'line-width': 1.5,
          'line-opacity': 0.5,
          // Borde discontinuo: marca un límite de conocimiento, no un límite
          // físico. Una línea continua parecería una frontera real.
          'line-dasharray': [3, 3],
        },
      });

      // --- Red vial de OpenStreetMap ---
      // Contexto del terreno, no un aviso: por eso va en gris, fina y por
      // debajo de todo lo que alguien reportó. Existe sobre todo para las zonas
      // donde el mapa base está vacío, que es donde más falta hace.
      instance.addLayer({
        id: 'roads-line',
        type: 'line',
        source: 'roads',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#6b7684',
          // Las troncales se ven más gruesas que las trochas, como en cualquier
          // mapa vial: la jerarquía es información.
          'line-width': [
            'match',
            ['get', 'highway'],
            'motorway', 3,
            'trunk', 2.6,
            'primary', 2.2,
            'secondary', 1.8,
            'tertiary', 1.4,
            1,
          ],
          // Discontinua cuando la vía no está pavimentada: en temporada de
          // lluvias eso decide qué vehículo puede pasar.
          'line-dasharray': ['case', ['get', 'unpaved'], ['literal', [2, 2]], ['literal', [1, 0]]],
          'line-opacity': 0.65,
        },
      });

      // --- Daño estructural (capa de fondo) ---
      // Va debajo de todo lo demás: describe el estado del edificado, que es
      // contexto para leer el resto, no una alerta en sí misma.
      instance.addLayer({
        id: 'damage-fill',
        type: 'fill',
        source: 'damage',
        // A menos de zoom 14 una huella de veinte metros no llega a un píxel.
        minzoom: 14,
        paint: {
          'fill-color': '#8B2E24',
          'fill-opacity': ['interpolate', ['linear'], ['get', 'ratio'], 0, 0.25, 1, 0.7],
          'fill-outline-color': '#d0342c',
        },
      });
      instance.addLayer({
        id: 'damage-point',
        type: 'circle',
        source: 'damage-centroids',
        maxzoom: 14,
        paint: {
          'circle-color': '#8B2E24',
          'circle-opacity': 0.55,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 2, 13, 5],
        },
      });

      // Tramos de vía primero, para que los puntos queden encima.
      instance.addLayer({
        id: 'paths-casing',
        type: 'line',
        source: 'paths',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': '#12161c', 'line-width': 7, 'line-opacity': 0.35 },
      });
      instance.addLayer({
        id: 'paths-line',
        type: 'line',
        source: 'paths',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 4,
          // La opacidad sigue a la confianza: un tramo reportado hace horas y
          // sin confirmar se ve literalmente desvanecido.
          'line-opacity': ['max', 0.25, ['get', 'confidence']],
        },
      });

      // Radio de afectación de los reportes de área (sin señal, sin energía).
      instance.addLayer({
        id: 'zones-area',
        type: 'circle',
        source: 'zones',
        filter: ['>', ['get', 'radiusMeters'], 0],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.12,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.4,
          // El radio en metros se convierte a píxeles según la latitud y el
          // zoom, que es como MapLibre expresa distancias reales.
          'circle-radius': [
            'interpolate',
            ['exponential', 2],
            ['zoom'],
            0,
            0,
            22,
            [
              '/',
              ['get', 'radiusMeters'],
              ['*', 0.019, ['cos', ['*', ['get', 'lat'], 0.01745]]],
            ],
          ],
        },
      });

      instance.addLayer({
        id: 'zones-point',
        type: 'circle',
        source: 'zones',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-opacity': ['max', 0.35, ['get', 'confidence']],
          // La gravedad define el tamaño: lo que puede costar una vida se ve
          // más grande que lo que es un inconveniente.
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            ['+', 3, ['get', 'severity']],
            12,
            ['+', 6, ['*', 2, ['get', 'severity']]],
          ],
          'circle-stroke-color': '#f2f3f1',
          'circle-stroke-width': ['case', ['get', 'selected'], 4, 2],
        },
      });

      // --- Réplicas (capa superior) ---
      // Anillos sin relleno, deliberadamente distintos de los pines de reporte:
      // no son algo que alguien reportó, son el evento físico. Confundir las
      // dos cosas en el mapa haría pensar que una réplica es un aviso que se
      // puede confirmar o refutar.
      instance.addLayer({
        id: 'aftershocks',
        type: 'circle',
        source: 'aftershocks',
        paint: {
          'circle-color': 'transparent',
          'circle-stroke-color': ['case', ['get', 'mainshock'], '#12161c', '#7a3fb0'],
          'circle-stroke-width': ['case', ['get', 'mainshock'], 3, 2],
          'circle-stroke-opacity': 0.85,
          // El radio crece con la magnitud, no linealmente: la energía liberada
          // es logarítmica y el área del círculo lo refleja mejor.
          'circle-radius': [
            'interpolate',
            ['exponential', 1.6],
            ['get', 'magnitude'],
            2.5,
            4,
            7.4,
            26,
          ],
        },
      });

      ready.current = true;
      instance.fire('zones-ready');
    });

    instance.on('click', 'zones-point', (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      event.originalEvent.stopPropagation();
      handlers.current.onSelect(JSON.parse(feature.properties!.raw as string) as ZoneView);
    });

    instance.on('click', (event) => {
      if (handlers.current.placing) {
        handlers.current.onPlace({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
      } else {
        handlers.current.onSelect(null);
      }
    });

    instance.on('click', 'aftershocks', (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      event.originalEvent.stopPropagation();
      handlers.current.onSelectAftershock(
        JSON.parse(feature.properties!.raw as string) as SeismicView,
      );
    });

    // Las dos capas de daño comparten manejador: son la misma edificación
    // dibujada como polígono de cerca y como punto de lejos.
    for (const layerId of ['damage-fill', 'damage-point']) {
      instance.on('click', layerId, (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        event.originalEvent.stopPropagation();
        handlers.current.onSelectDamage(
          JSON.parse(feature.properties!.raw as string) as DamageView,
        );
      });
    }

    for (const layerId of ['zones-point', 'aftershocks', 'damage-fill', 'damage-point']) {
      instance.on('mouseenter', layerId, () => {
        instance.getCanvas().style.cursor = 'pointer';
      });
      instance.on('mouseleave', layerId, () => {
        instance.getCanvas().style.cursor = handlers.current.placing ? 'crosshair' : '';
      });
    }

    instance.on('moveend', () => {
      const b = instance.getBounds();
      handlers.current.onBoundsChange?.(
        `${b.getWest().toFixed(4)},${b.getSouth().toFixed(4)},${b.getEast().toFixed(4)},${b
          .getNorth()
          .toFixed(4)}`,
      );
    });

    return () => {
      instance.remove();
      map.current = null;
      ready.current = false;
    };
  }, []);

  // Datos -> fuentes GeoJSON. Se usan capas de datos y no marcadores del DOM
  // porque el mapa puede llegar a cientos de reportes y un nodo por cada uno
  // hunde el rendimiento en un teléfono de gama baja.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    const apply = () => {
      const points = instance.getSource('zones') as maplibregl.GeoJSONSource | undefined;
      const paths = instance.getSource('paths') as maplibregl.GeoJSONSource | undefined;
      if (!points || !paths) return;

      points.setData({
        type: 'FeatureCollection',
        features: zones.map((zone) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [zone.location.longitude, zone.location.latitude],
          },
          properties: {
            color: zoneColor(zone.type),
            confidence: zone.confidence,
            severity: zone.severity,
            radiusMeters: zone.radiusMeters ?? 0,
            lat: zone.location.latitude,
            selected: zone.id === selectedId,
            raw: JSON.stringify(zone),
          },
        })),
      });

      paths.setData({
        type: 'FeatureCollection',
        features: zones
          .filter((zone) => zone.path && zone.path.length > 1)
          .map((zone) => ({
            type: 'Feature' as const,
            geometry: { type: 'LineString' as const, coordinates: zone.path! },
            properties: { color: zoneColor(zone.type), confidence: zone.confidence },
          })),
      });
    };

    if (ready.current) apply();
    else instance.once('zones-ready', apply);
  }, [zones, selectedId]);

  // Réplicas y daño estructural van en su propio efecto: se actualizan con una
  // cadencia mucho más lenta que los reportes de la comunidad y no tiene
  // sentido reconstruir su GeoJSON cada vez que alguien confirma una vía.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    const apply = () => {
      const quakes = instance.getSource('aftershocks') as maplibregl.GeoJSONSource | undefined;
      const buildings = instance.getSource('damage') as maplibregl.GeoJSONSource | undefined;
      const centroids = instance.getSource('damage-centroids') as
        | maplibregl.GeoJSONSource
        | undefined;
      const areas = instance.getSource('coverage') as maplibregl.GeoJSONSource | undefined;
      const network = instance.getSource('roads') as maplibregl.GeoJSONSource | undefined;
      if (!quakes || !buildings || !centroids || !areas || !network) return;

      network.setData({
        type: 'FeatureCollection',
        features: roads.map((road) => ({
          type: 'Feature' as const,
          geometry: road.path,
          properties: {
            highway: road.highway,
            unpaved: UNPAVED_SURFACES.has(road.surface ?? ''),
          },
        })),
      });

      areas.setData({
        type: 'FeatureCollection',
        features: coverage.map((area) => ({
          type: 'Feature' as const,
          geometry: area.area,
          properties: { city: area.city },
        })),
      });

      quakes.setData({
        type: 'FeatureCollection',
        features: aftershocks.map((event) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [event.longitude, event.latitude] },
          properties: {
            magnitude: event.magnitude,
            mainshock: event.isMainshock,
            // El registro completo viaja en las propiedades para que el clic
            // pueda mostrar el detalle sin volver a consultar la API.
            raw: JSON.stringify(event),
          },
        })),
      });

      // La misma edificación en dos representaciones: el polígono se dibuja de
      // cerca y el punto de lejos. El centroide lo calcula PostGIS al servir
      // los datos, no el navegador.
      buildings.setData({
        type: 'FeatureCollection',
        features: damage.map((building) => ({
          type: 'Feature' as const,
          geometry: building.footprint,
          properties: {
            ratio: building.damageRatio ?? 0.5,
            city: building.city,
            raw: JSON.stringify(building),
          },
        })),
      });

      centroids.setData({
        type: 'FeatureCollection',
        features: damage.map((building) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [building.centroid.longitude, building.centroid.latitude],
          },
          properties: {
            ratio: building.damageRatio ?? 0.5,
            city: building.city,
            raw: JSON.stringify(building),
          },
        })),
      });
    };

    if (ready.current) apply();
    else instance.once('zones-ready', apply);
  }, [aftershocks, damage, coverage, roads]);

  /**
   * Resumen por municipio, como marcadores del DOM y no como capa de datos.
   *
   * Son pocos —decenas, no miles— y cada uno tiene que mostrar varias cifras
   * con su etiqueta. Una capa de MapLibre dibuja formas y texto suelto; un
   * elemento del DOM permite jerarquía tipográfica, es enfocable con el teclado
   * y se lee con lector de pantalla. Para lo que hay muchos —zonas, réplicas,
   * edificaciones— se sigue usando la GPU.
   */
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    for (const existing of aggregateMarkers.current) existing.remove();
    aggregateMarkers.current = [];

    for (const item of aggregates) {
      if (!item.point) continue;

      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'agg-marker';
      element.setAttribute('aria-label', ariaLabelFor(item));

      const headline = headlineFor(item);
      element.innerHTML = `
        <span class="agg-bar" style="background:${headline.color}"></span>
        <span class="agg-body">
          <span class="agg-value">${headline.value}</span>
          <span class="agg-unit">${headline.unit}</span>
          <span class="agg-name">${escapeHtml(item.municipality)}</span>
        </span>
      `;

      element.addEventListener('click', (nativeEvent) => {
        nativeEvent.stopPropagation();
        handlers.current.onSelectMunicipality(item);
      });

      aggregateMarkers.current.push(
        new maplibregl.Marker({ element, anchor: 'bottom' })
          .setLngLat([item.point.longitude, item.point.latitude])
          .addTo(instance),
      );
    }

    return () => {
      for (const existing of aggregateMarkers.current) existing.remove();
      aggregateMarkers.current = [];
    };
  }, [aggregates]);

  // Marcador de la ubicación que se está eligiendo para un reporte nuevo.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    marker.current?.remove();
    marker.current = null;

    if (pendingMarker) {
      const element = document.createElement('div');
      element.style.cssText =
        'width:22px;height:22px;background:#12161c;border:3px solid #f2f3f1;box-shadow:0 0 0 2px #12161c';
      marker.current = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat([pendingMarker.longitude, pendingMarker.latitude])
        .addTo(instance);
    }
  }, [pendingMarker]);

  useEffect(() => {
    const canvas = map.current?.getCanvas();
    if (canvas) canvas.style.cursor = placing ? 'crosshair' : '';
  }, [placing]);

  return <div ref={container} className="h-full w-full" aria-label="Mapa de zonas afectadas" />;
}

/**
 * Qué cifra encabeza el recuadro de un municipio.
 *
 * Siempre lleva su unidad escrita al lado. Un número suelto que unas veces
 * significa personas y otras edificaciones se malinterpreta, y en este contexto
 * confundir "266" edificaciones con 266 desaparecidos no es un detalle.
 *
 * El orden refleja qué importa primero: personas sin localizar, luego lo que
 * impide llegar hasta ellas, y por último el estado del edificado.
 */
function headlineFor(item: MunicipalityAggregate): {
  value: string;
  unit: string;
  color: string;
} {
  if (item.desaparecidos.activos > 0) {
    return {
      value: String(item.desaparecidos.activos),
      unit: item.desaparecidos.activos === 1 ? 'sin localizar' : 'sin localizar',
      color: ROJA,
    };
  }
  if (item.zonas.viasBloqueadas > 0) {
    return {
      value: String(item.zonas.viasBloqueadas),
      unit: item.zonas.viasBloqueadas === 1 ? 'vía cortada' : 'vías cortadas',
      color: NARANJA,
    };
  }
  if (item.danos.edificaciones > 0) {
    return {
      value: item.danos.edificaciones.toLocaleString('es-CO'),
      unit: 'edificaciones',
      color: '#8B2E24',
    };
  }
  return {
    value: String(item.zonas.total),
    unit: item.zonas.total === 1 ? 'reporte' : 'reportes',
    color: VIA,
  };
}

function ariaLabelFor(item: MunicipalityAggregate): string {
  const parts = [`${item.municipality}`];
  if (item.desaparecidos.activos) parts.push(`${item.desaparecidos.activos} personas sin localizar`);
  if (item.zonas.viasBloqueadas) parts.push(`${item.zonas.viasBloqueadas} vías cortadas`);
  if (item.danos.edificaciones) parts.push(`${item.danos.edificaciones} edificaciones dañadas`);
  if (item.replicas.conteo) parts.push(`${item.replicas.conteo} réplicas cerca`);
  return `${parts.join(', ')}. Ver detalle del municipio.`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[char];
  });
}
