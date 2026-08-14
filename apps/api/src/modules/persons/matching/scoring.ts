import { GeoPoint, haversineMeters, halfLifeDecay } from 'src/common/geo/geo.util';
import { nameSimilarity } from 'src/common/text/similarity';
import { MatchBreakdown } from '../entities/match-candidate.entity';
import { MatchTier, Sex } from '../persons.enums';

/**
 * Scoring de coincidencia entre un reporte de desaparicion y un avistamiento.
 *
 * Tres principios guian el diseno:
 *
 * 1. Solo se ponderan las senales presentes. Si el avistamiento no trae edad,
 *    la edad no aporta ni resta: los pesos se renormalizan sobre lo que si hay.
 *    Castigar la ausencia de datos penalizaria justo a los reportes tomados en
 *    las peores condiciones, que son los que mas importan.
 *
 * 2. Ninguna senal por si sola decide. Un apellido comun en un pais de 50
 *    millones no es identidad. El documento es la unica excepcion, y por eso
 *    tiene su propio nivel.
 *
 * 3. El resultado es una propuesta, no un veredicto. Todo lo que salga de aqui
 *    va a una cola donde una persona decide. El score ordena esa cola; no
 *    reemplaza el juicio humano.
 */

/** Media distancia del decaimiento geografico: a 15 km el aporte cae a la mitad. */
const GEO_HALF_DISTANCE_M = 15_000;

/** Media vida temporal: a 96 h de separacion el aporte cae a la mitad. */
const TIME_HALF_LIFE_HOURS = 96;

const WEIGHTS = {
  name: 0.32,
  age: 0.12,
  sex: 0.1,
  geo: 0.18,
  time: 0.1,
  physical: 0.18,
  /** Cuando hay comparacion facial, domina el resto de senales. */
  face: 0.45,
} as const;

export interface MatchSubject {
  fullName: string | null;
  documentHash: string | null;
  ageMin: number | null;
  ageMax: number | null;
  sex: Sex;
  heightCm: number | null;
  build: string | null;
  skinTone: string | null;
  hairColor: string | null;
  distinguishingMarks: string | null;
  location: GeoPoint | null;
  at: Date | null;
  faceDescriptors: number[][];
}

export interface ScoreResult {
  score: number;
  tier: MatchTier;
  breakdown: MatchBreakdown;
}

/**
 * Solapamiento entre dos rangos de edad.
 *
 * Se comparan rangos y no numeros porque de un lado hay una edad declarada por
 * la familia (confiable) y del otro una estimacion visual hecha en segundos
 * sobre una persona herida o cubierta de polvo, que se equivoca con facilidad
 * en cinco o diez anos.
 */
function scoreAge(
  aMin: number | null,
  aMax: number | null,
  bMin: number | null,
  bMax: number | null,
): number | null {
  if (aMin === null || aMax === null || bMin === null || bMax === null) return null;

  const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
  if (overlap >= 0) {
    const spanA = aMax - aMin;
    const spanB = bMax - bMin;
    const narrower = Math.min(spanA, spanB);
    // Rangos puntuales que se tocan cuentan como coincidencia plena.
    if (narrower === 0) return 1;
    return Math.min(1, 0.6 + 0.4 * (overlap / narrower));
  }

  // Sin solapamiento: la separacion en anos degrada rapido, pero no a cero,
  // porque una estimacion visual puede errar por mas de lo que declara.
  const gap = -overlap;
  return Math.max(0, halfLifeDecay(gap, 6) * 0.5);
}

function scoreSex(a: Sex, b: Sex): number | null {
  if (a === Sex.UNKNOWN || b === Sex.UNKNOWN) return null;
  return a === b ? 1 : 0;
}

/** Similitud entre dos descripciones libres cortas ("delgada", "castaño oscuro"). */
function scoreText(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return nameSimilarity(a, b);
}

/**
 * Rasgos fisicos. Las senas particulares (cicatrices, tatuajes) pesan mas que
 * el resto porque sobreviven a una foto mala y a la descripcion apresurada:
 * "cicatriz en el antebrazo izquierdo" identifica mucho mas que "cabello
 * castaño" en una poblacion mayoritariamente de cabello castaño.
 */
function scorePhysical(a: MatchSubject, b: MatchSubject): number | null {
  const parts: { value: number; weight: number }[] = [];

  if (a.heightCm !== null && b.heightCm !== null) {
    const diff = Math.abs(a.heightCm - b.heightCm);
    parts.push({ value: halfLifeDecay(Math.max(0, diff - 3), 7), weight: 2 });
  }

  const build = scoreText(a.build, b.build);
  if (build !== null) parts.push({ value: build, weight: 1 });

  const hair = scoreText(a.hairColor, b.hairColor);
  if (hair !== null) parts.push({ value: hair, weight: 1 });

  const skin = scoreText(a.skinTone, b.skinTone);
  if (skin !== null) parts.push({ value: skin, weight: 1 });

  const marks = scoreText(a.distinguishingMarks, b.distinguishingMarks);
  if (marks !== null) parts.push({ value: marks, weight: 3 });

  if (!parts.length) return null;

  const total = parts.reduce((sum, p) => sum + p.weight, 0);
  return parts.reduce((sum, p) => sum + p.value * p.weight, 0) / total;
}

/** Similitud coseno entre vectores faciales, reescalada al rango 0..1. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;

  const cosine = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(0, Math.min(1, (cosine + 1) / 2));
}

function scoreFace(a: MatchSubject, b: MatchSubject): number | null {
  if (!a.faceDescriptors.length || !b.faceDescriptors.length) return null;

  // Con varias fotos por reporte se toma el mejor par: basta una toma en la
  // que ambas caras sean comparables.
  let best = 0;
  for (const da of a.faceDescriptors) {
    for (const db of b.faceDescriptors) {
      best = Math.max(best, cosineSimilarity(da, db));
    }
  }
  return best;
}

export function scoreMatch(missing: MatchSubject, sighting: MatchSubject): ScoreResult {
  const reasons: string[] = [];

  // --- Nivel 1: documento de identidad ---
  // Es la unica senal que basta por si sola. Rara vez esta disponible en
  // campo, pero cuando aparece no hay nada que ponderar.
  if (missing.documentHash && sighting.documentHash) {
    if (missing.documentHash === sighting.documentHash) {
      return {
        score: 1,
        tier: MatchTier.DETERMINISTIC,
        breakdown: {
          document: 1,
          name: null,
          age: null,
          sex: null,
          geo: null,
          time: null,
          physical: null,
          face: null,
          weights: { document: 1 },
          distanceMeters: null,
          hoursApart: null,
          reasons: ['Documento de identidad idéntico'],
        },
      };
    }
    reasons.push('Documentos de identidad distintos');
  }

  // --- Senales ponderadas ---
  const name =
    missing.fullName && sighting.fullName
      ? nameSimilarity(missing.fullName, sighting.fullName)
      : null;

  const age = scoreAge(missing.ageMin, missing.ageMax, sighting.ageMin, sighting.ageMax);
  const sex = scoreSex(missing.sex, sighting.sex);
  const physical = scorePhysical(missing, sighting);
  const face = scoreFace(missing, sighting);

  let distanceMeters: number | null = null;
  let geo: number | null = null;
  if (missing.location && sighting.location) {
    distanceMeters = haversineMeters(missing.location, sighting.location);
    geo = halfLifeDecay(distanceMeters, GEO_HALF_DISTANCE_M);
  }

  let hoursApart: number | null = null;
  let time: number | null = null;
  if (missing.at && sighting.at) {
    hoursApart = (sighting.at.getTime() - missing.at.getTime()) / 3_600_000;
    if (hoursApart < -12) {
      // Visto antes de desaparecer: posible, pero es mas probable que sean
      // personas distintas o que una de las dos fechas este mal.
      time = 0.1;
      reasons.push('El avistamiento es anterior a la desaparición');
    } else {
      time = halfLifeDecay(Math.max(0, hoursApart), TIME_HALF_LIFE_HOURS);
    }
  }

  const signals: { key: keyof typeof WEIGHTS; value: number | null }[] = [
    { key: 'name', value: name },
    { key: 'age', value: age },
    { key: 'sex', value: sex },
    { key: 'geo', value: geo },
    { key: 'time', value: time },
    { key: 'physical', value: physical },
    { key: 'face', value: face },
  ];

  const present = signals.filter((s) => s.value !== null);
  const weightTotal = present.reduce((sum, s) => sum + WEIGHTS[s.key], 0);

  const weights: Record<string, number> = {};
  let score = 0;
  if (weightTotal > 0) {
    for (const signal of present) {
      // Renormalizacion: los pesos de las senales presentes suman 1, de modo
      // que un reporte con pocos datos no queda condenado a un score bajo por
      // el solo hecho de estar incompleto.
      const weight = WEIGHTS[signal.key] / weightTotal;
      weights[signal.key] = Number(weight.toFixed(4));
      score += (signal.value as number) * weight;
    }
  }

  // --- Topes de seguridad ---
  // Ciertas contradicciones no bajan el score: lo limitan. Un buen puntaje en
  // todo lo demas no puede arrastrar a la cola de revision un par que se
  // contradice en un dato duro.
  if (missing.documentHash && sighting.documentHash && missing.documentHash !== sighting.documentHash) {
    score = Math.min(score, 0.15);
  }
  if (sex === 0) {
    // El sexo se registra mal con cierta frecuencia en personas inconscientes,
    // asi que no se anula el candidato; solo se le impide alcanzar el umbral
    // de revision por su cuenta.
    score = Math.min(score, 0.25);
    reasons.push('El sexo registrado no coincide');
  }
  if (age !== null && age < 0.2) {
    // Rangos de edad muy separados. Sin este tope, un nombre identico y un sexo
    // coincidente bastan para colar en la cola a dos homonimos de generaciones
    // distintas, y en un pais de 50 millones de habitantes eso pasa a diario:
    // un nombre no es una identidad.
    score = Math.min(score, 0.45);
    reasons.push('Los rangos de edad son incompatibles');
  }

  // --- Razones legibles para la cola de revision ---
  if (name !== null && name >= 0.85) reasons.push(`Nombre muy similar (${(name * 100).toFixed(0)}%)`);
  else if (name !== null && name >= 0.6) reasons.push(`Nombre parcialmente similar (${(name * 100).toFixed(0)}%)`);
  if (distanceMeters !== null && distanceMeters < 5_000)
    reasons.push(`A ${(distanceMeters / 1000).toFixed(1)} km del último punto conocido`);
  if (age !== null && age >= 0.8) reasons.push('Rango de edad compatible');
  if (physical !== null && physical >= 0.75) reasons.push('Descripción física compatible');
  if (face !== null && face >= 0.8) reasons.push(`Similitud facial alta (${(face * 100).toFixed(0)}%)`);
  if (hoursApart !== null && hoursApart >= 0 && hoursApart <= 48)
    reasons.push(`Visto ${hoursApart.toFixed(0)} h después de la desaparición`);

  const tier = face !== null && face >= 0.8 ? MatchTier.BIOMETRIC : MatchTier.HEURISTIC;

  return {
    score: Number(Math.max(0, Math.min(1, score)).toFixed(4)),
    tier,
    breakdown: {
      document: null,
      name,
      age,
      sex,
      geo,
      time,
      physical,
      face,
      weights,
      distanceMeters: distanceMeters !== null ? Math.round(distanceMeters) : null,
      hoursApart: hoursApart !== null ? Number(hoursApart.toFixed(2)) : null,
      reasons,
    },
  };
}
