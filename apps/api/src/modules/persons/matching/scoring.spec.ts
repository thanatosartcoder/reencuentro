import { toGeoPoint } from 'src/common/geo/geo.util';
import { nameSimilarity, normalizeDocument } from 'src/common/text/similarity';
import { MatchSubject, scoreMatch } from './scoring';
import { MatchTier, Sex } from '../persons.enums';

function subject(overrides: Partial<MatchSubject> = {}): MatchSubject {
  return {
    fullName: null,
    documentHash: null,
    ageMin: null,
    ageMax: null,
    sex: Sex.UNKNOWN,
    heightCm: null,
    build: null,
    skinTone: null,
    hairColor: null,
    distinguishingMarks: null,
    location: null,
    at: null,
    faceDescriptors: [],
    ...overrides,
  };
}

const PEREIRA = toGeoPoint(4.8133, -75.6961);
const PEREIRA_CERCA = toGeoPoint(4.8087, -75.6906); // ~700 m
const CALI = toGeoPoint(3.4516, -76.532); // ~190 km

describe('nameSimilarity', () => {
  it('ignora tildes y mayúsculas', () => {
    expect(nameSimilarity('María Ríos', 'maria rios')).toBe(1);
  });

  it('tolera el orden invertido de nombre y apellido', () => {
    const score = nameSimilarity('María Fernanda Ríos', 'Ríos María Fernanda');
    expect(score).toBeGreaterThan(0.95);
  });

  it('acepta iniciales en lugar del nombre completo', () => {
    const score = nameSimilarity('María Fernanda Ríos Valencia', 'Maria F. Rios');
    expect(score).toBeGreaterThan(0.7);
  });

  it('reconoce variantes fonéticas del español', () => {
    // Transcripciones distintas de un mismo nombre oído en campo.
    expect(nameSimilarity('Yeison Vallejo', 'Jeison Ballejo')).toBeGreaterThan(0.75);
    expect(nameSimilarity('González', 'Gonsales')).toBeGreaterThan(0.75);
  });

  it('separa nombres realmente distintos', () => {
    expect(nameSimilarity('Carlos Martínez', 'Andrea Quintero')).toBeLessThan(0.5);
  });
});

describe('normalizeDocument', () => {
  it('descarta puntos, guiones y ceros a la izquierda', () => {
    expect(normalizeDocument('1.088.234-567')).toBe('1088234567');
    expect(normalizeDocument('0001088234567')).toBe('1088234567');
  });
});

describe('scoreMatch', () => {
  it('el documento idéntico produce un match determinístico', () => {
    const result = scoreMatch(
      subject({ documentHash: 'abc123', fullName: 'Persona Uno' }),
      subject({ documentHash: 'abc123', fullName: 'Otro Nombre Distinto' }),
    );

    expect(result.score).toBe(1);
    expect(result.tier).toBe(MatchTier.DETERMINISTIC);
  });

  it('documentos distintos limitan el score aunque todo lo demás coincida', () => {
    const result = scoreMatch(
      subject({
        documentHash: 'aaa',
        fullName: 'María Fernanda Ríos',
        sex: Sex.FEMALE,
        ageMin: 32,
        ageMax: 36,
        location: PEREIRA,
      }),
      subject({
        documentHash: 'bbb',
        fullName: 'María Fernanda Ríos',
        sex: Sex.FEMALE,
        ageMin: 33,
        ageMax: 35,
        location: PEREIRA_CERCA,
      }),
    );

    expect(result.score).toBeLessThanOrEqual(0.15);
  });

  it('un sexo contradictorio impide alcanzar el umbral de revisión', () => {
    const result = scoreMatch(
      subject({ fullName: 'Alex Moreno', sex: Sex.FEMALE, location: PEREIRA }),
      subject({ fullName: 'Alex Moreno', sex: Sex.MALE, location: PEREIRA_CERCA }),
    );

    expect(result.score).toBeLessThanOrEqual(0.25);
    expect(result.breakdown.reasons).toContain('El sexo registrado no coincide');
  });

  it('el caso realista de campo supera el umbral de revisión', () => {
    // Reporte de la familia frente a un ingreso hospitalario: nombre incompleto,
    // edad estimada en rango y varias horas de diferencia.
    const missing = subject({
      fullName: 'María Fernanda Ríos Valencia',
      ageMin: 32,
      ageMax: 36,
      sex: Sex.FEMALE,
      heightCm: 162,
      build: 'delgada',
      hairColor: 'castaño oscuro',
      distinguishingMarks: 'Cicatriz de 3 cm en el antebrazo izquierdo',
      location: PEREIRA,
      at: new Date('2026-08-10T13:04:00Z'),
    });

    const sighting = subject({
      fullName: 'Maria F. Rios',
      ageMin: 30,
      ageMax: 38,
      sex: Sex.FEMALE,
      heightCm: 160,
      build: 'delgada',
      hairColor: 'castaño',
      distinguishingMarks: 'Cicatriz en antebrazo izquierdo',
      location: PEREIRA_CERCA,
      at: new Date('2026-08-10T21:34:00Z'),
    });

    const result = scoreMatch(missing, sighting);

    expect(result.score).toBeGreaterThanOrEqual(0.55);
    expect(result.tier).toBe(MatchTier.HEURISTIC);
    expect(result.breakdown.distanceMeters).toBeLessThan(1500);
  });

  it('un homónimo lejano no alcanza el umbral', () => {
    const result = scoreMatch(
      subject({
        fullName: 'Carlos Martínez',
        sex: Sex.MALE,
        ageMin: 40,
        ageMax: 46,
        location: PEREIRA,
        at: new Date('2026-08-10T13:00:00Z'),
      }),
      subject({
        fullName: 'Carlos Martínez',
        sex: Sex.MALE,
        ageMin: 18,
        ageMax: 24,
        location: CALI,
        at: new Date('2026-08-13T13:00:00Z'),
      }),
    );

    expect(result.score).toBeLessThan(0.55);
  });

  it('no penaliza al reporte incompleto: renormaliza sobre lo que existe', () => {
    // Solo hay nombre y ubicación. El score no debe hundirse por los campos
    // ausentes, o los reportes tomados en las peores condiciones quedarían
    // sistemáticamente fuera de la cola.
    const result = scoreMatch(
      subject({ fullName: 'Luis Alberto Mena', location: PEREIRA }),
      subject({ fullName: 'Luis Alberto Mena', location: PEREIRA_CERCA }),
    );

    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(Object.keys(result.breakdown.weights).sort()).toEqual(['geo', 'name']);
  });

  it('penaliza un avistamiento anterior a la desaparición', () => {
    const result = scoreMatch(
      subject({ fullName: 'Ana Gómez', at: new Date('2026-08-12T12:00:00Z'), location: PEREIRA }),
      subject({ fullName: 'Ana Gómez', at: new Date('2026-08-10T12:00:00Z'), location: PEREIRA }),
    );

    expect(result.breakdown.time).toBe(0.1);
    expect(result.breakdown.reasons).toContain('El avistamiento es anterior a la desaparición');
  });

  it('la similitud facial alta clasifica el candidato como biométrico', () => {
    const descriptor = [0.9, 0.1, 0.4, 0.2];
    const result = scoreMatch(
      subject({ fullName: 'Sin Nombre', faceDescriptors: [descriptor] }),
      subject({ fullName: 'Sin Nombre', faceDescriptors: [descriptor] }),
    );

    expect(result.tier).toBe(MatchTier.BIOMETRIC);
    expect(result.breakdown.face).toBe(1);
  });
});
