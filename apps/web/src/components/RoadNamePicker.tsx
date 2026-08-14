'use client';

import { useEffect, useState } from 'react';
import { api, type NearbyRoad } from '@/lib/api';

/**
 * Selector del nombre de la vía a partir de la red real de OpenStreetMap.
 *
 * Escribir el nombre a mano produce "vía Quibdó–Pereira", "via a pereira" y
 * "carretera quibdo pereira" para el mismo corredor, y el sistema no puede
 * saber que hablan de lo mismo: tres reportes del mismo derrumbe se ven como
 * tres derrumbes distintos.
 *
 * Ofrecer los nombres que ya existen en el mapa hace que coincidan solos. El
 * campo libre se mantiene porque OSM no lo tiene todo, y menos en Chocó: si la
 * vía no está mapeada, el reporte igual tiene que poder hacerse.
 */
export function RoadNamePicker({
  coords,
  value,
  onChange,
}: {
  coords: { latitude: number; longitude: number } | null;
  value: string;
  onChange: (name: string) => void;
}) {
  const [nearby, setNearby] = useState<NearbyRoad[]>([]);
  const [loading, setLoading] = useState(false);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!coords) {
      setNearby([]);
      return;
    }

    setLoading(true);
    api
      .get<{ items: NearbyRoad[] }>(
        `/vias/cerca?lat=${coords.latitude}&lon=${coords.longitude}&radiusMeters=2000`,
      )
      .then((response) => setNearby(response.items))
      .catch(() => setNearby([]))
      .finally(() => setLoading(false));
  }, [coords]);

  return (
    <div className="mt-5">
      <p className="text-[16px] font-semibold">
        Nombre de la vía o del lugar
        <span className="ml-2 text-[13px] font-normal text-ink-faint">opcional</span>
      </p>
      <p className="mb-1.5 mt-0.5 text-[14px] leading-snug text-ink-faint">
        {loading
          ? 'Buscando vías cercanas…'
          : nearby.length > 0
            ? 'Elige la vía o escríbela si no está en la lista.'
            : 'Escríbela como la conozcas.'}
      </p>

      {nearby.length > 0 && !typing && (
        <ul className="mb-2 space-y-1">
          {nearby.slice(0, 6).map((road) => {
            const selected = value === road.name;
            return (
              <li key={road.name}>
                <button
                  type="button"
                  onClick={() => onChange(selected ? '' : road.name)}
                  className={`flex min-h-[48px] w-full items-center justify-between gap-3 border-2 px-3 py-2 text-left ${
                    selected ? 'border-ink bg-ink text-paper' : 'border-rule'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium">{road.name}</span>
                    <span
                      className={`block text-[12px] ${selected ? 'text-paper/70' : 'text-ink-faint'}`}
                    >
                      {highwayLabel(road.highway)}
                      {road.surface ? ` · ${surfaceLabel(road.surface)}` : ''}
                    </span>
                  </span>
                  {road.distanceMeters !== null && (
                    <span
                      className={`num shrink-0 text-[12px] ${
                        selected ? 'text-paper/70' : 'text-ink-faint'
                      }`}
                    >
                      {road.distanceMeters < 1000
                        ? `${road.distanceMeters} m`
                        : `${(road.distanceMeters / 1000).toFixed(1)} km`}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setTyping(event.target.value.length > 0 && !nearby.some((r) => r.name === event.target.value));
        }}
        onFocus={() => setTyping(true)}
        onBlur={() => setTyping(false)}
        placeholder={nearby.length > 0 ? 'O escríbela aquí' : ''}
        maxLength={200}
        className="w-full border-2 border-rule bg-paper px-3 py-3 text-[16px] focus:border-ink focus:outline-none"
      />

      {nearby.length > 0 && (
        <p className="mt-1.5 text-[12px] leading-snug text-ink-faint">
          Nombres tomados de OpenStreetMap, del mapeo humanitario del 13 de agosto.
        </p>
      )}
    </div>
  );
}

function highwayLabel(highway: string): string {
  return (
    {
      motorway: 'Autopista',
      trunk: 'Troncal',
      trunk_link: 'Enlace de troncal',
      primary: 'Vía primaria',
      primary_link: 'Enlace primario',
      secondary: 'Vía secundaria',
      secondary_link: 'Enlace secundario',
      tertiary: 'Vía terciaria',
      tertiary_link: 'Enlace terciario',
      unclassified: 'Vía rural',
      residential: 'Vía urbana',
      track: 'Trocha',
      living_street: 'Vía peatonalizada',
      road: 'Vía sin clasificar',
    }[highway] ?? highway
  );
}

function surfaceLabel(surface: string): string {
  return (
    {
      paved: 'pavimentada',
      asphalt: 'asfalto',
      concrete: 'concreto',
      unpaved: 'destapada',
      gravel: 'afirmado',
      dirt: 'tierra',
      ground: 'tierra',
      earth: 'tierra',
      sand: 'arena',
      mud: 'barro',
      cobblestone: 'adoquín',
    }[surface] ?? surface
  );
}
