import { enqueue, type OperationType } from './outbox';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Fallo de red, distinto de una respuesta de error del servidor. */
export class OfflineError extends Error {
  constructor() {
    super('Sin conexión');
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // fetch solo rechaza por fallo de transporte. Se distingue de un 4xx/5xx
    // porque la respuesta es encolar y reintentar, no mostrar un error.
    throw new OfflineError();
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    const message = Array.isArray(body.message)
      ? body.message.join('. ')
      : (body.message ?? `Error ${response.status}`);
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, { ...init, method: 'GET' }),
  post: <T>(path: string, body: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'DELETE' }),
};

/**
 * Envía una operación o la guarda para después.
 *
 * Este es el único camino por el que la app escribe. Si hay red, la operación
 * viaja de inmediato; si no la hay, entra al outbox y la persona ve su reporte
 * como guardado igual. Desde su punto de vista no hay diferencia, que es el
 * objetivo: en Chocó la falta de señal es la condición normal, no la excepción.
 */
export async function submit<T>(options: {
  path: string;
  type: OperationType;
  clientUuid: string;
  payload: Record<string, unknown>;
  targetId?: string;
  label: string;
}): Promise<{ result: T | null; queued: boolean }> {
  try {
    const result = await api.post<T>(options.path, options.payload);
    return { result, queued: false };
  } catch (error) {
    if (error instanceof OfflineError) {
      await enqueue({
        clientUuid: options.clientUuid,
        type: options.type,
        targetId: options.targetId,
        payload: options.payload,
        label: options.label,
      });
      return { result: null, queued: true };
    }
    // Un 400 significa que el reporte está mal formado: reintentarlo mil veces
    // no lo va a arreglar y solo llenaría la cola. Se devuelve a la interfaz
    // para que la persona corrija.
    throw error;
  }
}

// --- Tipos compartidos con la API ---

export interface ZoneView {
  id: string;
  clientUuid: string;
  type: string;
  label: string;
  layer: 'ROAD' | 'HAZARD' | 'RESOURCE' | 'SERVICE';
  location: { latitude: number; longitude: number };
  path: [number, number][] | null;
  radiusMeters: number | null;
  description: string | null;
  roadName: string | null;
  department: string | null;
  municipality: string | null;
  severity: number;
  confidence: number;
  confirmations: number;
  refutations: number;
  reportedAt: string;
  lastConfirmedAt: string;
  reporterRole: string;
  reporterOrganization: string | null;
  status: string;
  revision: string;
  distanceMeters?: number;
}

export interface ZoneType {
  type: string;
  label: string;
  halfLifeMinutes: number;
  severity: number;
  layer: 'ROAD' | 'HAZARD' | 'RESOURCE' | 'SERVICE';
}

/** Panorama de un municipio: lo que cruza todas las fuentes en un solo punto. */
export interface MunicipalityAggregate {
  municipality: string;
  department: string | null;
  point: { latitude: number; longitude: number } | null;
  pointIsApproximate: boolean;
  desaparecidos: {
    activos: number;
    localizadosConVida: number;
    localizadosSinVida: number;
    menores: number;
    total: number;
  };
  avistamientos: { abiertos: number };
  zonas: {
    total: number;
    porCapa: Record<string, number>;
    severidadMaxima: number;
    viasBloqueadas: number;
  };
  danos: { edificaciones: number; evaluado: boolean };
  replicas: { conteo: number; magnitudMaxima: number | null };
  prioridad: number;
}

/** Estado de las ingestas externas: cuándo se actualizó cada capa. */
export interface IngestStatus {
  fuentes: {
    fuente: 'HDX_DAMAGE' | 'HOT_ROADS';
    ultimaCargaExitosa: string | null;
    versionOrigen: string | null;
    registros: number | null;
    ultimoIntento: { estado: string; cuando: string; error: string | null } | null;
  }[];
  cronActivo: boolean;
  horarios: Record<string, string>;
}

/** Tramo de la red vial de OpenStreetMap. Qué vías existen, no cuáles pasan. */
export interface RoadView {
  id: string;
  osmId: string;
  highway: string;
  name: string | null;
  surface: string | null;
  isBridge: boolean;
  isTunnel: boolean;
  lengthMeters: number | null;
  path: { type: 'LineString'; coordinates: [number, number][] };
}

/** Vía con nombre cerca de un punto, para el autocompletado al reportar. */
export interface NearbyRoad {
  name: string;
  highway: string;
  surface: string | null;
  distanceMeters: number | null;
  lengthKm?: number;
  segments: number;
}

/** Área con evaluación de daño publicada: dónde se ha mirado. */
export interface CoverageView {
  id: string;
  city: string;
  department: string | null;
  publisher: string;
  imagerySource: string | null;
  imageryDate: string | null;
  buildingsAssessed: number | null;
  area: { type: 'Polygon'; coordinates: number[][][] };
}

/** Qué hay alrededor de un punto concreto. */
export interface AreaContext {
  radioMetros: number;
  desaparecidos: { activos: number; menores: number };
  avistamientos: number;
  zonas: { activas: number; viasBloqueadas: number; recursos: number };
  danos: number;
  replicas: { conteo: number; magnitudMaxima: number | null };
}

/** Evento sísmico replicado del catálogo del USGS. */
export interface SeismicView {
  id: string;
  source: string;
  externalId: string;
  occurredAt: string;
  magnitude: number;
  magnitudeType: string | null;
  depthKm: number | null;
  latitude: number;
  longitude: number;
  place: string | null;
  distanceToMainshockKm: number | null;
  isMainshock: boolean;
  communityIntensity: number | null;
  detailUrl: string | null;
}

/** Edificación evaluada por el modelo de daño publicado en HDX. */
export interface DamageView {
  id: string;
  city: string;
  buildingId: string | null;
  damaged: boolean;
  damageRatio: number | null;
  unknownRatio: number | null;
  footprint: { type: 'MultiPolygon'; coordinates: number[][][][] };
  centroid: { latitude: number; longitude: number };
  imageryDate: string | null;
  imagerySource: string | null;
  footprintSource: string | null;
  publisher: string;
}

/** Foto con sus dos variantes; el navegador elige cuál descarga. */
export interface PhotoRef {
  id: string;
  url: string;
  urlAvif: string | null;
  width: number | null;
  height: number | null;
}

export interface MissingPerson {
  id: string;
  fullName: string;
  aliases: string[];
  age: number | null;
  ageMin: number | null;
  ageMax: number | null;
  sex: string;
  heightCm: number | null;
  build: string | null;
  skinTone: string | null;
  hairColor: string | null;
  clothingDescription: string | null;
  distinguishingMarks: string | null;
  isMinor: boolean;
  department: string | null;
  municipality: string | null;
  lastSeenAt: string | null;
  circumstances: string | null;
  status: string;
  reportedAt: string;
  hasPhoto: boolean;
  photos: PhotoRef[];
}

export interface SituationOverview {
  /**
   * La emergencia en curso. Siempre presente: es la fila del evento.
   *
   * `evento` y `cifrasOficiales` pueden venir en null — una emergencia recién
   * declarada todavía no tiene balance oficial publicado, y decirlo es más
   * honesto que mostrar ceros.
   */
  emergencia: {
    slug: string;
    nombre: string;
    tipo: string;
    ocurrioEl: string;
    departamentos: string[];
  } | null;
  evento: {
    name: string;
    occurredAt: string;
    magnitude: number;
    depthKm: number;
    epicenter: { latitude: number; longitude: number; description: string };
    aftershocksReported: number;
  } | null;
  epicentro: {
    name: string;
    department: string;
    latitude: number;
    longitude: number;
  } | null;
  cifrasOficiales: ({
    asOf: string;
    source: string;
    deceased: number;
    injured: number;
    missing: number;
    rescued: number;
    affectedPeople: number;
    affectedFamilies: number;
    housesDestroyed: number;
    departmentsAffected: number;
    municipalitiesAffected: number;
    aviso: string;
  }) | null;
  capitalesAfectadas: {
    name: string;
    department: string;
    latitude: number;
    longitude: number;
    alertLevel: 'ROJA' | 'NARANJA' | 'AMARILLA';
    notes: string;
  }[];
  plataforma: {
    activos: number;
    encontradosConVida: number;
    encontradosSinVida: number;
    avistamientosAbiertos: number;
    totalReportes: number;
    aviso: string;
  };
}
