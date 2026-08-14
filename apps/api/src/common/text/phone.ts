/**
 * Normalizacion de telefonos colombianos a formato E.164 sin el signo `+`.
 *
 * El mismo numero llega escrito de cinco formas distintas ("300 123 4567",
 * "+57 300-1234567", "0300...") y todas deben producir el mismo indice ciego,
 * porque de eso depende reconocer que dos reportes vienen del mismo contacto.
 */
export function normalizePhoneCo(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  // Ya trae indicativo de pais.
  if (digits.startsWith('57') && digits.length === 12) return digits;
  // Celular nacional de 10 digitos: 3XX XXX XXXX.
  if (digits.length === 10 && digits.startsWith('3')) return `57${digits}`;
  // Fijo con indicativo de ciudad.
  if (digits.length === 10) return `57${digits}`;
  // Fijo de 7 digitos sin indicativo: no se puede completar sin adivinar la
  // ciudad, y adivinar produciria colisiones entre personas distintas.
  if (digits.length === 7) return null;
  // Numero internacional: se deja tal cual.
  if (digits.length >= 11 && digits.length <= 15) return digits;

  return null;
}
