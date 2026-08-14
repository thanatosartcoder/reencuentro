/**
 * Similitud de nombres tolerante a los errores tipicos de un reporte tomado
 * en campo: tildes perdidas, apellidos invertidos, nombres incompletos,
 * iniciales y variantes foneticas del espanol ("Yeison" / "Jeison",
 * "Vallejo" / "Ballejo", "Gonzalez" / "Gonsales").
 */

const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'do', 'san', 'santa']);

/** Minuscula, sin tildes, sin puntuacion, espacios colapsados. */
export function normalizeName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reduccion fonetica para espanol. Colapsa los pares de letras que suenan
 * igual, de modo que dos transcripciones distintas del mismo nombre oido
 * convergen a la misma cadena.
 */
export function phoneticEs(token: string): string {
  return token
    .replace(/^h/, '')
    .replace(/h/g, '')
    .replace(/qu/g, 'k')
    .replace(/gu([ei])/g, 'g$1')
    .replace(/[cs]([ei])/g, 'z$1')
    .replace(/c/g, 'k')
    .replace(/ll/g, 'y')
    .replace(/v/g, 'b')
    .replace(/s/g, 'z')
    .replace(/x/g, 'z')
    .replace(/j/g, 'g')
    .replace(/(.)\1+/g, '$1');
}

/** Jaro-Winkler clasico. Devuelve 0..1. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;

  // Bonus de Winkler por prefijo comun (maximo 4 caracteres).
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] !== b[i]) break;
    prefix++;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Piso de la similitud entre tokens.
 *
 * Jaro-Winkler reparte generosamente: dos nombres castellanos sin ninguna
 * relacion comparten suficientes letras como para puntuar entre 0.5 y 0.6.
 * Sin corregir eso, "Carlos Martinez" y "Andrea Quintero" salen con 0.60 y
 * cualquier umbral razonable se llena de ruido.
 *
 * Por debajo del piso el aporte se considera nulo y por encima se reescala al
 * rango completo, de modo que la escala mide lo que interesa: cuanto se parecen
 * dos nombres *que ya se parecen*, no cuantas letras comparte el alfabeto.
 */
const TOKEN_SIMILARITY_FLOOR = 0.6;

function sharpen(similarity: number): number {
  if (similarity <= TOKEN_SIMILARITY_FLOOR) return 0;
  return (similarity - TOKEN_SIMILARITY_FLOOR) / (1 - TOKEN_SIMILARITY_FLOOR);
}

/** Similitud entre dos tokens, mezclando forma escrita y forma fonetica. */
function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;

  // Inicial contra nombre completo: "J." frente a "Jose" es informacion debil
  // pero real. Se le asigna un valor fijo ya en la escala final, sin pasar por
  // el reescalado, porque no proviene de una comparacion de cadenas.
  if (a.length === 1 || b.length === 1) {
    return a[0] === b[0] ? 0.6 : 0;
  }

  const literal = jaroWinkler(a, b);
  // La reduccion fonetica pierde informacion, asi que se le descuenta un poco
  // frente a una coincidencia literal del mismo valor.
  const phonetic = jaroWinkler(phoneticEs(a), phoneticEs(b)) * 0.97;

  return sharpen(Math.max(literal, phonetic));
}

/**
 * Compara dos nombres completos sin asumir el orden de los tokens: en campo
 * "Maria Fernanda Rios" y "Rios Maria F." son la misma persona.
 *
 * Cada token del nombre mas corto se empareja con su mejor pareja disponible
 * del otro nombre (asignacion greedy, sin reutilizar tokens), y el resultado
 * se pondera por la longitud del token para que los apellidos pesen mas que
 * las particulas.
 */
export function nameSimilarity(rawA: string, rawB: string): number {
  const a = normalizeName(rawA);
  const b = normalizeName(rawB);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const tokensA = a.split(' ').filter((t) => !PARTICLES.has(t));
  const tokensB = b.split(' ').filter((t) => !PARTICLES.has(t));
  if (!tokensA.length || !tokensB.length) return 0;

  const [shorter, longer] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];

  const used = new Set<number>();
  let weightedSum = 0;
  let weightTotal = 0;

  for (const token of shorter) {
    let bestScore = 0;
    let bestIndex = -1;
    for (let i = 0; i < longer.length; i++) {
      if (used.has(i)) continue;
      const score = tokenSimilarity(token, longer[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0) used.add(bestIndex);

    const weight = Math.max(2, token.length);
    weightedSum += bestScore * weight;
    weightTotal += weight;
  }

  const base = weightTotal ? weightedSum / weightTotal : 0;

  // Penalizacion suave cuando un nombre tiene muchos mas tokens que el otro:
  // "Juan Perez" vs "Juan Carlos Perez Gomez" no deberia puntuar como identico.
  const coverage = shorter.length / longer.length;
  const coveragePenalty = 0.85 + 0.15 * coverage;

  return Math.min(1, base * coveragePenalty);
}

/** Compara documentos de identidad ignorando puntos, guiones y ceros a la izquierda. */
export function normalizeDocument(value: string): string {
  return value.replace(/[^0-9a-zA-Z]/g, '').replace(/^0+/, '').toUpperCase();
}
