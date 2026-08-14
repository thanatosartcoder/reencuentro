/**
 * Color de cada tipo de reporte en el mapa.
 *
 * El color no decora: codifica si algo se puede pasar, si es peligroso, si hay
 * ayuda o si es un servicio caído. La paleta es la del código de alertas que
 * usa la gestión de riesgo colombiana, para que signifique aquí lo mismo que en
 * la señalización oficial.
 */
export const ROJA = '#d0342c';
export const NARANJA = '#e07b18';
export const AMARILLA = '#d9ae1f';
export const VIA = '#1e7a5a';
export const SIGNAL = '#2b6cb0';

const BY_TYPE: Record<string, string> = {
  // Vías: rojo no se pasa, naranja se pasa con dificultad, verde se pasa.
  ROAD_BLOCKED: ROJA,
  BRIDGE_DOWN: ROJA,
  LANDSLIDE: ROJA,
  ROAD_PARTIAL: NARANJA,
  ROAD_4X4_ONLY: AMARILLA,
  ROAD_PASSABLE: VIA,

  // Peligro activo.
  COLLAPSED_BUILDING: ROJA,
  UNSTABLE_STRUCTURE: NARANJA,
  FIRE: ROJA,
  GAS_LEAK: ROJA,
  FLOOD: NARANJA,
  AFTERSHOCK_DAMAGE: NARANJA,

  // Recursos disponibles.
  SHELTER: VIA,
  MEDICAL_POST: VIA,
  SUPPLY_POINT: VIA,
  WATER_POINT: VIA,
  HELICOPTER_LZ: VIA,
  FUEL: VIA,

  // Operación y servicios.
  ACTIVE_RESCUE: ROJA,
  PEOPLE_TRAPPED: ROJA,
  NO_SIGNAL: SIGNAL,
  POWER_OUTAGE: SIGNAL,
  NO_WATER: SIGNAL,
};

export function zoneColor(type: string): string {
  return BY_TYPE[type] ?? SIGNAL;
}

export const LAYER_LABELS: Record<string, string> = {
  ROAD: 'Vías',
  HAZARD: 'Peligros',
  RESOURCE: 'Ayuda disponible',
  SERVICE: 'Servicios',
};
