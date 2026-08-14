/** Que esta reportando el usuario en el mapa. */
export enum ZoneReportType {
  // Estado de vias
  ROAD_BLOCKED = 'ROAD_BLOCKED',
  ROAD_PARTIAL = 'ROAD_PARTIAL',
  ROAD_PASSABLE = 'ROAD_PASSABLE',
  ROAD_4X4_ONLY = 'ROAD_4X4_ONLY',
  BRIDGE_DOWN = 'BRIDGE_DOWN',
  LANDSLIDE = 'LANDSLIDE',

  // Peligros activos
  COLLAPSED_BUILDING = 'COLLAPSED_BUILDING',
  UNSTABLE_STRUCTURE = 'UNSTABLE_STRUCTURE',
  FIRE = 'FIRE',
  GAS_LEAK = 'GAS_LEAK',
  FLOOD = 'FLOOD',
  AFTERSHOCK_DAMAGE = 'AFTERSHOCK_DAMAGE',

  // Recursos disponibles
  SHELTER = 'SHELTER',
  MEDICAL_POST = 'MEDICAL_POST',
  SUPPLY_POINT = 'SUPPLY_POINT',
  WATER_POINT = 'WATER_POINT',
  HELICOPTER_LZ = 'HELICOPTER_LZ',
  FUEL = 'FUEL',

  // Operaciones y servicios
  ACTIVE_RESCUE = 'ACTIVE_RESCUE',
  PEOPLE_TRAPPED = 'PEOPLE_TRAPPED',
  NO_SIGNAL = 'NO_SIGNAL',
  POWER_OUTAGE = 'POWER_OUTAGE',
  NO_WATER = 'NO_WATER',
}

export enum ZoneReportStatus {
  ACTIVE = 'ACTIVE',
  /** Alguien confirmo que la situacion se resolvio (via despejada, incendio apagado). */
  RESOLVED = 'RESOLVED',
  /** Vencio por antiguedad sin confirmaciones. */
  EXPIRED = 'EXPIRED',
  /** Retirado por un moderador: spam, duplicado evidente o informacion falsa. */
  MODERATED_OUT = 'MODERATED_OUT',
}

export enum VoteKind {
  /** "Sigue asi" — el reporte continua vigente. */
  CONFIRM = 'CONFIRM',
  /** "Ya no" — la situacion cambio. */
  REFUTE = 'REFUTE',
}

export interface ZoneTypeConfig {
  label: string;
  /**
   * Minutos en los que la confianza cae a la mitad si nadie confirma.
   *
   * Un rescate activo deja de ser noticia en un par de horas; un albergue sigue
   * abierto por dias. Usar una sola vida media para todo haria que la mitad de
   * los reportes caduquen antes de tiempo y la otra mitad se quede fantasma en
   * el mapa mucho despues de dejar de ser cierta.
   */
  halfLifeMinutes: number;
  /** Ordena la atencion en el mapa: 5 es riesgo de vida inmediato. */
  severity: number;
  /** Familia de capa para el visor. */
  layer: 'ROAD' | 'HAZARD' | 'RESOURCE' | 'SERVICE';
  /** Solo cuentan reportes de rol acreditado (rescatista, salud, oficial). */
  requiresTrustedRole?: boolean;
}

export const ZONE_TYPE_CONFIG: Record<ZoneReportType, ZoneTypeConfig> = {
  [ZoneReportType.ROAD_BLOCKED]: { label: 'Vía bloqueada', halfLifeMinutes: 360, severity: 4, layer: 'ROAD' },
  [ZoneReportType.ROAD_PARTIAL]: { label: 'Paso restringido', halfLifeMinutes: 240, severity: 3, layer: 'ROAD' },
  [ZoneReportType.ROAD_PASSABLE]: { label: 'Vía habilitada', halfLifeMinutes: 480, severity: 1, layer: 'ROAD' },
  [ZoneReportType.ROAD_4X4_ONLY]: { label: 'Solo 4x4', halfLifeMinutes: 480, severity: 2, layer: 'ROAD' },
  [ZoneReportType.BRIDGE_DOWN]: { label: 'Puente caído', halfLifeMinutes: 2880, severity: 5, layer: 'ROAD' },
  [ZoneReportType.LANDSLIDE]: { label: 'Derrumbe', halfLifeMinutes: 720, severity: 4, layer: 'ROAD' },

  [ZoneReportType.COLLAPSED_BUILDING]: { label: 'Edificación colapsada', halfLifeMinutes: 2880, severity: 5, layer: 'HAZARD' },
  [ZoneReportType.UNSTABLE_STRUCTURE]: { label: 'Estructura inestable', halfLifeMinutes: 1440, severity: 4, layer: 'HAZARD' },
  [ZoneReportType.FIRE]: { label: 'Incendio', halfLifeMinutes: 120, severity: 5, layer: 'HAZARD' },
  [ZoneReportType.GAS_LEAK]: { label: 'Fuga de gas', halfLifeMinutes: 180, severity: 5, layer: 'HAZARD' },
  [ZoneReportType.FLOOD]: { label: 'Inundación', halfLifeMinutes: 480, severity: 4, layer: 'HAZARD' },
  [ZoneReportType.AFTERSHOCK_DAMAGE]: { label: 'Daño por réplica', halfLifeMinutes: 720, severity: 4, layer: 'HAZARD' },

  [ZoneReportType.SHELTER]: { label: 'Albergue', halfLifeMinutes: 2880, severity: 1, layer: 'RESOURCE' },
  [ZoneReportType.MEDICAL_POST]: { label: 'Puesto médico', halfLifeMinutes: 1440, severity: 1, layer: 'RESOURCE' },
  [ZoneReportType.SUPPLY_POINT]: { label: 'Punto de acopio', halfLifeMinutes: 1440, severity: 1, layer: 'RESOURCE' },
  [ZoneReportType.WATER_POINT]: { label: 'Punto de agua', halfLifeMinutes: 720, severity: 2, layer: 'RESOURCE' },
  [ZoneReportType.HELICOPTER_LZ]: { label: 'Zona de aterrizaje', halfLifeMinutes: 1440, severity: 2, layer: 'RESOURCE' },
  [ZoneReportType.FUEL]: { label: 'Combustible', halfLifeMinutes: 360, severity: 2, layer: 'RESOURCE' },

  [ZoneReportType.ACTIVE_RESCUE]: { label: 'Rescate en curso', halfLifeMinutes: 120, severity: 5, layer: 'SERVICE' },
  [ZoneReportType.PEOPLE_TRAPPED]: { label: 'Personas atrapadas', halfLifeMinutes: 90, severity: 5, layer: 'SERVICE' },
  [ZoneReportType.NO_SIGNAL]: { label: 'Sin señal', halfLifeMinutes: 720, severity: 2, layer: 'SERVICE' },
  [ZoneReportType.POWER_OUTAGE]: { label: 'Sin energía', halfLifeMinutes: 720, severity: 2, layer: 'SERVICE' },
  [ZoneReportType.NO_WATER]: { label: 'Sin acueducto', halfLifeMinutes: 1440, severity: 2, layer: 'SERVICE' },
};
