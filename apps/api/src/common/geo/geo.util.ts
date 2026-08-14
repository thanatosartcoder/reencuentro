/** Punto GeoJSON tal como TypeORM lo entrega y lo espera en columnas `geography`. */
export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitud, latitud]
}

export interface GeoLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

/** Construye un punto GeoJSON a partir de lat/lon en el orden humano. */
export function toGeoPoint(latitude: number, longitude: number): GeoPoint {
  return { type: 'Point', coordinates: [longitude, latitude] };
}

export function fromGeoPoint(point: GeoPoint | null | undefined): {
  latitude: number;
  longitude: number;
} | null {
  if (!point?.coordinates) return null;
  return { longitude: point.coordinates[0], latitude: point.coordinates[1] };
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Distancia en metros sobre la esfera. Suficiente para scoring; PostGIS hace el filtrado exacto. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const [lon1, lat1] = a.coordinates;
  const [lon2, lat2] = b.coordinates;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Decaimiento exponencial generico: vale 1 a distancia/edad cero y 0.5 en el
 * punto medio indicado. Se usa tanto para proximidad geografica como para
 * antiguedad de un reporte.
 */
export function halfLifeDecay(value: number, halfLife: number): number {
  if (halfLife <= 0) return value <= 0 ? 1 : 0;
  return Math.pow(2, -Math.max(0, value) / halfLife);
}

export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** Parsea "minLon,minLat,maxLon,maxLat" tal como lo envia el visor del mapa. */
export function parseBbox(raw: string): BoundingBox {
  const parts = raw.split(',').map((n) => Number(n.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error('bbox debe tener el formato minLon,minLat,maxLon,maxLat');
  }
  const [minLon, minLat, maxLon, maxLat] = parts;
  return { minLon, minLat, maxLon, maxLat };
}
