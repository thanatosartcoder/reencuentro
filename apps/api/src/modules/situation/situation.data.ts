/**
 * Datos oficiales del sismo del 10 de agosto de 2026.
 *
 * Se mantienen como constantes versionadas en codigo, no en base de datos, por
 * una razon deliberada: son cifras oficiales de terceros y deben poder
 * auditarse contra su fuente. Cada actualizacion queda en el historial de git
 * con su corte y su origen, en lugar de sobrescribirse en una tabla.
 *
 * Fuentes: UNGRD (balance del 13/08/2026 22:30), Fiscalia General de la Nacion
 * (desaparecidos), Servicio Geologico Colombiano (parametros del sismo),
 * Invias (estado de corredores viales).
 */

export const EVENT = {
  name: 'Sismo de San José del Palmar',
  occurredAt: '2026-08-10T12:34:00.000Z', // 07:34 hora local (UTC-5)
  magnitude: 7.4,
  depthKm: 96,
  epicenter: {
    latitude: 4.99,
    longitude: -76.29,
    description: 'A unos 12 km de San José del Palmar, Chocó',
  },
  aftershocksReported: 130,
  aftershocksAsOf: '2026-08-12T11:00:00.000Z',
} as const;

export const IMPACT = {
  asOf: '2026-08-13T22:30:00.000Z',
  source: 'UNGRD',
  deceased: 284,
  injured: 3977,
  missing: 379,
  rescued: 354,
  affectedPeople: 102263,
  affectedFamilies: 45523,
  housesDamaged: 71763,
  housesDestroyed: 12597,
  buildingsCollapsed: 121,
  departmentsAffected: 15,
  municipalitiesAffected: 426,
  infrastructure: {
    healthCenters: 240,
    schools: 2205,
    communityCenters: 1208,
    roads: 210,
    aqueducts: 73,
    vehicleBridges: 44,
    pedestrianBridges: 13,
    airports: 5,
  },
} as const;

export interface AffectedCapital {
  name: string;
  department: string;
  latitude: number;
  longitude: number;
  alertLevel: 'ROJA' | 'NARANJA' | 'AMARILLA';
  notes: string;
}

/**
 * Las cinco capitales en alerta roja concentran 375 de los 379 desaparecidos y
 * 311 estructuras colapsadas. Popayan se incluye en naranja por los cortes de
 * energia y servicios reportados.
 */
export const AFFECTED_CAPITALS: AffectedCapital[] = [
  {
    name: 'Quibdó',
    department: 'Chocó',
    latitude: 5.6947,
    longitude: -76.6611,
    alertLevel: 'ROJA',
    notes: 'Departamento del epicentro. Vías cortadas y fallas de comunicación.',
  },
  {
    name: 'Cali',
    department: 'Valle del Cauca',
    latitude: 3.4516,
    longitude: -76.532,
    alertLevel: 'ROJA',
    notes: 'Búsqueda activa entre escombros. Evacuaciones ordenadas por réplicas.',
  },
  {
    name: 'Pereira',
    department: 'Risaralda',
    latitude: 4.8133,
    longitude: -75.6961,
    alertLevel: 'ROJA',
    notes: 'Corredor Quibdó–Pereira intervenido por orden del Gobierno Nacional.',
  },
  {
    name: 'Manizales',
    department: 'Caldas',
    latitude: 5.0703,
    longitude: -75.5138,
    alertLevel: 'ROJA',
    notes: 'Evacuación de edificaciones tras las réplicas del 13 de agosto.',
  },
  {
    name: 'Armenia',
    department: 'Quindío',
    latitude: 4.5339,
    longitude: -75.6811,
    alertLevel: 'ROJA',
    notes: 'Más de 10.000 viviendas afectadas.',
  },
  {
    name: 'Popayán',
    department: 'Cauca',
    latitude: 2.4448,
    longitude: -76.6147,
    alertLevel: 'NARANJA',
    notes: 'Cortes de energía y afectación de servicios.',
  },
];

export const EPICENTER_TOWN = {
  name: 'San José del Palmar',
  department: 'Chocó',
  latitude: 4.8969,
  longitude: -76.2278,
};
