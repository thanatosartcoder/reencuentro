import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { toGeoPoint } from 'src/common/geo/geo.util';
import { blindIndex } from 'src/common/crypto/field-crypto';
import { generateClaimToken, hashToken } from 'src/common/crypto/tokens';
import { normalizeDocument } from 'src/common/text/similarity';
import { Operator, OperatorRole } from 'src/modules/auth/entities/operator.entity';
import { ZoneReport } from 'src/modules/geo/entities/zone-report.entity';
import { ZoneReportType, ZONE_TYPE_CONFIG } from 'src/modules/geo/geo.enums';
// La confianza base por rol vive junto al servicio que la aplica, para que el
// seed no pueda divergir del calculo real.
import { ROLE_BASE_CONFIDENCE } from 'src/modules/geo/geo.service';
import { MissingPersonReport } from 'src/modules/persons/entities/missing-person-report.entity';
import { SightingReport } from 'src/modules/persons/entities/sighting-report.entity';
import {
  DocumentType,
  PersonCondition,
  ReportSource,
  ReporterRole,
  Sex,
  SightingKind,
} from 'src/modules/persons/persons.enums';

/**
 * Datos iniciales.
 *
 * Se divide en dos partes con criterios distintos:
 *
 * 1. Geografia y corredores viales: informacion REAL, tomada de los reportes de
 *    Invias, la UNGRD y el SGC sobre el sismo del 10 de agosto de 2026. Sirve
 *    para que el mapa arranque con las zonas criticas ya marcadas.
 *
 * 2. Personas: registros SINTETICOS. No se siembran personas reales. Los 379
 *    desaparecidos del reporte oficial son casos con familias esperando
 *    respuesta; inventar registros con nombres reales o publicar datos de
 *    personas reales sin su consentimiento seria danino y probablemente ilegal.
 *    Los registros de prueba llevan la marca [SINTÉTICO] y solo existen para
 *    ejercitar el motor de matching en desarrollo.
 */

const SEED_DEVICE = 'seed-ungrd-invias-0001';

/** Momento del sismo, referencia para fechar los reportes sembrados. */
const QUAKE_AT = new Date('2026-08-10T12:34:00.000Z');

function hoursAfterQuake(hours: number): Date {
  return new Date(QUAKE_AT.getTime() + hours * 3_600_000);
}

interface SeedZone {
  clientUuid: string;
  type: ZoneReportType;
  lat: number;
  lon: number;
  path?: [number, number][];
  description: string;
  roadName?: string;
  department: string;
  municipality: string;
  hoursAfter: number;
  role: ReporterRole;
  organization: string;
  confirmations: number;
  severity?: number;
  radiusMeters?: number;
}

/**
 * Corredores y zonas confirmados por fuentes oficiales.
 * Invias reporto 18 vias principales danadas y 13 corredores todavia con
 * problemas de transito al dia siguiente del sismo.
 */
const SEED_ZONES: SeedZone[] = [
  {
    clientUuid: '11111111-0000-4000-8000-000000000001',
    type: ZoneReportType.LANDSLIDE,
    lat: 5.2793,
    lon: -76.0923,
    path: [
      [-76.1547, 5.3358],
      [-76.1211, 5.3102],
      [-76.0923, 5.2793],
      [-76.03, 5.2236],
    ],
    description:
      'Daño total de la banca por derrumbe. Corredor Santa Cecilia – Asia sin paso vehicular.',
    roadName: 'Santa Cecilia – Asia',
    department: 'Risaralda',
    municipality: 'Pueblo Rico',
    hoursAfter: 3,
    role: ReporterRole.OFFICIAL,
    organization: 'Invías',
    confirmations: 12,
    severity: 5,
  },
  {
    clientUuid: '11111111-0000-4000-8000-000000000002',
    type: ZoneReportType.ROAD_PARTIAL,
    lat: 3.7519,
    lon: -76.5231,
    path: [
      [-76.532, 3.4516],
      [-76.5502, 3.5611],
      [-76.5231, 3.7519],
    ],
    description:
      'Paso restringido hacia el Cruce de la Ruta 40 (Loboguerrero). Atención priorizada para restablecer el tránsito.',
    roadName: 'Cali – Loboguerrero (Ruta 40)',
    department: 'Valle del Cauca',
    municipality: 'Dagua',
    hoursAfter: 5,
    role: ReporterRole.OFFICIAL,
    organization: 'Invías',
    confirmations: 9,
    severity: 4,
  },
  {
    clientUuid: '11111111-0000-4000-8000-000000000003',
    type: ZoneReportType.ROAD_PARTIAL,
    lat: 5.2653,
    lon: -76.5583,
    path: [
      [-76.6611, 5.6947],
      [-76.5583, 5.2653],
      [-75.8814, 4.8987],
      [-75.6961, 4.8133],
    ],
    description:
      'Corredor Quibdó – Pereira con trabajos intensificados por orden del Gobierno Nacional. Paso intermitente.',
    roadName: 'Quibdó – Pereira',
    department: 'Chocó',
    municipality: 'Tadó',
    hoursAfter: 8,
    role: ReporterRole.OFFICIAL,
    organization: 'Invías',
    confirmations: 15,
    severity: 4,
  },
  {
    clientUuid: '11111111-0000-4000-8000-000000000004',
    type: ZoneReportType.NO_SIGNAL,
    lat: 4.8969,
    lon: -76.2278,
    description:
      'Fallas de comunicación en el área del epicentro. Sin cobertura celular estable.',
    department: 'Chocó',
    municipality: 'San José del Palmar',
    hoursAfter: 1,
    role: ReporterRole.OFFICIAL,
    organization: 'UNGRD',
    confirmations: 21,
    severity: 4,
    radiusMeters: 25_000,
  },
  {
    clientUuid: '11111111-0000-4000-8000-000000000005',
    type: ZoneReportType.ACTIVE_RESCUE,
    lat: 3.4516,
    lon: -76.532,
    description: 'Búsqueda y rescate entre escombros en curso. Perímetro cerrado.',
    department: 'Valle del Cauca',
    municipality: 'Cali',
    hoursAfter: 2,
    role: ReporterRole.RESCUER,
    organization: 'Defensa Civil Colombiana',
    confirmations: 18,
    severity: 5,
  },
  {
    clientUuid: '11111111-0000-4000-8000-000000000006',
    type: ZoneReportType.COLLAPSED_BUILDING,
    lat: 5.0703,
    lon: -75.5138,
    description:
      'Estructuras colapsadas en el centro. Evacuación ordenada tras las réplicas del 13 de agosto.',
    department: 'Caldas',
    municipality: 'Manizales',
    hoursAfter: 4,
    role: ReporterRole.OFFICIAL,
    organization: 'UNGRD',
    confirmations: 14,
    severity: 5,
  },
  {
    clientUuid: '11111111-0000-4000-8000-000000000007',
    type: ZoneReportType.SHELTER,
    lat: 4.5339,
    lon: -75.6811,
    description:
      'Albergue temporal habilitado. Más de 10.000 viviendas afectadas en el municipio.',
    department: 'Quindío',
    municipality: 'Armenia',
    hoursAfter: 10,
    role: ReporterRole.OFFICIAL,
    organization: 'Cruz Roja Colombiana',
    confirmations: 11,
    severity: 1,
  },
  {
    clientUuid: '11111111-0000-4000-8000-000000000008',
    type: ZoneReportType.MEDICAL_POST,
    lat: 5.6947,
    lon: -76.6611,
    description: 'Puesto médico avanzado recibiendo heridos del área del epicentro.',
    department: 'Chocó',
    municipality: 'Quibdó',
    hoursAfter: 6,
    role: ReporterRole.HEALTH_STAFF,
    organization: 'Cruz Roja Colombiana',
    confirmations: 16,
    severity: 1,
  },
  {
    clientUuid: '11111111-0000-4000-8000-000000000009',
    type: ZoneReportType.POWER_OUTAGE,
    lat: 2.4448,
    lon: -76.6147,
    description: 'Cortes de energía y afectación de servicios públicos.',
    department: 'Cauca',
    municipality: 'Popayán',
    hoursAfter: 3,
    role: ReporterRole.OFFICIAL,
    organization: 'UNGRD',
    confirmations: 8,
    severity: 3,
    radiusMeters: 12_000,
  },
  {
    clientUuid: '11111111-0000-4000-8000-000000000010',
    type: ZoneReportType.SUPPLY_POINT,
    lat: 4.8133,
    lon: -75.6961,
    description: 'Centro de acopio para el corredor hacia Chocó.',
    department: 'Risaralda',
    municipality: 'Pereira',
    hoursAfter: 12,
    role: ReporterRole.VOLUNTEER,
    organization: 'Cruz Roja Colombiana',
    confirmations: 7,
    severity: 1,
  },
];

async function seedOperators(dataSource: DataSource): Promise<void> {
  const repo = dataSource.getRepository(Operator);

  const operators = [
    {
      email: 'validador@reencuentro.co',
      fullName: 'Validador de prueba',
      organization: 'Cruz Roja Colombiana',
      role: OperatorRole.VALIDATOR,
      password: 'Reencuentro2026!',
    },
    {
      email: 'coordinador@reencuentro.co',
      fullName: 'Coordinador de prueba',
      organization: 'UNGRD',
      role: OperatorRole.COORDINATOR,
      password: 'Reencuentro2026!',
    },
  ];

  for (const op of operators) {
    const existing = await repo.findOne({ where: { email: op.email } });
    if (existing) continue;
    await repo.save(
      repo.create({
        email: op.email,
        fullName: op.fullName,
        organization: op.organization,
        role: op.role,
        passwordHash: await bcrypt.hash(op.password, 12),
        // La contraseña de estas cuentas está escrita en el repositorio: hasta
        // que se cambie, la sesión no puede ver datos de personas.
        mustChangePassword: true,
      }),
    );
  }
  console.log(`  operadores: ${operators.length} verificados`);
}

async function seedZones(dataSource: DataSource): Promise<void> {
  const repo = dataSource.getRepository(ZoneReport);
  let created = 0;

  // La siembra describe el sismo de agosto: sus zonas pertenecen a ese evento.
  const eventos: { id: string }[] = await dataSource.query(
    `SELECT id FROM events WHERE slug = 'sismo-san-jose-del-palmar-2026'`,
  );
  const eventId = eventos[0]?.id;
  if (!eventId) {
    throw new Error('Falta el evento del sismo. Ejecuta las migraciones antes de sembrar.');
  }

  for (const zone of SEED_ZONES) {
    const existing = await repo.findOne({ where: { clientUuid: zone.clientUuid } });
    if (existing) continue;

    const config = ZONE_TYPE_CONFIG[zone.type];
    const reportedAt = hoursAfterQuake(zone.hoursAfter);

    await repo.save(
      repo.create({
        eventId,
        clientUuid: zone.clientUuid,
        type: zone.type,
        location: toGeoPoint(zone.lat, zone.lon),
        path: zone.path ? { type: 'LineString', coordinates: zone.path } : null,
        radiusMeters: zone.radiusMeters ?? null,
        description: zone.description,
        roadName: zone.roadName ?? null,
        department: zone.department,
        municipality: zone.municipality,
        severity: zone.severity ?? config.severity,
        reportedAt,
        halfLifeMinutes: config.halfLifeMinutes,
        baseConfidence: ROLE_BASE_CONFIDENCE[zone.role],
        confirmations: zone.confirmations,
        refutations: 0,
        // Los reportes oficiales se han venido reconfirmando; se fechan como
        // confirmados recientemente para que no aparezcan ya desvanecidos.
        lastConfirmedAt: new Date(Date.now() - 45 * 60_000),
        reporterRole: zone.role,
        reporterOrganization: zone.organization,
        deviceId: SEED_DEVICE,
      }),
    );
    created++;
  }
  console.log(`  zonas: ${created} creadas, ${SEED_ZONES.length - created} ya existían`);
}

/**
 * Caso sintetico para ejercitar el matching de punta a punta: un reporte de
 * desaparicion y un avistamiento que deberian emparejar por nombre aproximado,
 * edad compatible y proximidad geografica, sin documento de por medio.
 */
async function seedSyntheticMatchCase(dataSource: DataSource): Promise<void> {
  const missingRepo = dataSource.getRepository(MissingPersonReport);
  const sightingRepo = dataSource.getRepository(SightingReport);

  const missingUuid = '22222222-0000-4000-8000-000000000001';
  const sightingUuid = '33333333-0000-4000-8000-000000000001';

  const alreadySeeded = await missingRepo.findOne({ where: { clientUuid: missingUuid } });
  if (alreadySeeded) {
    console.log('  caso sintético: ya existía');
    return;
  }

  const claimToken = generateClaimToken();

  await missingRepo.save(
    missingRepo.create({
      clientUuid: missingUuid,
      fullName: 'María Fernanda Ríos Valencia',
      aliases: ['Marifer'],
      documentType: DocumentType.CC,
      documentNumber: '1088234567',
      documentHash: blindIndex(normalizeDocument('1088234567')),
      age: 34,
      ageMin: 32,
      ageMax: 36,
      sex: Sex.FEMALE,
      heightCm: 162,
      build: 'delgada',
      hairColor: 'castaño oscuro',
      clothingDescription: 'Blusa blanca y jean azul',
      distinguishingMarks: 'Cicatriz de unos 3 cm en el antebrazo izquierdo',
      isMinor: false,
      lastSeenLocation: toGeoPoint(4.8133, -75.6961),
      lastSeenAddress: 'Sector centro',
      department: 'Risaralda',
      municipality: 'Pereira',
      lastSeenAt: hoursAfterQuake(0.5),
      circumstances:
        '[SINTÉTICO] Registro de prueba para desarrollo. No corresponde a una persona real.',
      reporterName: 'Reportante de prueba',
      reporterPhone: '3001234567',
      reporterPhoneHash: blindIndex('573001234567'),
      reporterRelationship: 'Hermano',
      reporterRole: ReporterRole.FAMILY,
      claimTokenHash: hashToken(claimToken),
      source: ReportSource.IMPORT,
      consentPublicListing: true,
    }),
  );

  // Mismo nombre transcrito de oido, sin apellido completo y con edad estimada:
  // asi es como llega la informacion desde un puesto medico en campo.
  await sightingRepo.save(
    sightingRepo.create({
      clientUuid: sightingUuid,
      kind: SightingKind.HOSPITAL_ADMISSION,
      fullName: 'Maria F. Rios',
      documentType: DocumentType.NINGUNO,
      estimatedAgeMin: 30,
      estimatedAgeMax: 38,
      sex: Sex.FEMALE,
      heightCm: 160,
      build: 'delgada',
      hairColor: 'castaño',
      distinguishingMarks: 'Cicatriz en antebrazo izquierdo',
      condition: PersonCondition.INJURED,
      isMinor: false,
      location: toGeoPoint(4.8087, -75.6906),
      address: 'Puesto médico avanzado',
      department: 'Risaralda',
      municipality: 'Pereira',
      facilityName: 'Puesto médico avanzado – Pereira',
      seenAt: hoursAfterQuake(9),
      notes: '[SINTÉTICO] Registro de prueba para desarrollo.',
      reporterName: 'Personal de salud de prueba',
      reporterRole: ReporterRole.HEALTH_STAFF,
      reporterOrganization: 'Cruz Roja Colombiana',
      source: ReportSource.IMPORT,
      status: 'OPEN',
    }),
  );

  console.log('  caso sintético: 1 desaparición + 1 avistamiento creados');
  console.log(`  claim token del caso sintético: ${claimToken}`);
}

export async function runEarthquakeSeed(dataSource: DataSource): Promise<void> {
  console.log('Sembrando datos del sismo del 10 de agosto de 2026...');
  await seedOperators(dataSource);
  await seedZones(dataSource);
  await seedSyntheticMatchCase(dataSource);
  console.log('Listo.');
}
