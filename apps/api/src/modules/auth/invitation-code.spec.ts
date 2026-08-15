import {
  codeMatches,
  formatCode,
  generateVerificationCode,
  hashCode,
  normalizeCode,
} from './invitation-code';

describe('código de verificación de invitaciones', () => {
  it('no genera caracteres que se confundan al dictarlos', () => {
    // 0/O, 1/I/L, 5/S y 8/B se oyen igual por teléfono con mala señal. Un
    // código que hay que repetir tres veces termina mandándose por escrito,
    // que es justo lo que la partición en dos canales evita.
    const confusos = /[01OIL58B]/;
    for (let i = 0; i < 500; i++) {
      expect(generateVerificationCode()).not.toMatch(confusos);
    }
  });

  it('tiene seis caracteres', () => {
    expect(generateVerificationCode()).toHaveLength(6);
  });

  it('acepta el código como lo teclea alguien que lo oyó', () => {
    const code = 'A2C4EF';
    const hash = hashCode(code);

    // Minúsculas, con el guion con que se muestra, con espacios.
    expect(codeMatches('a2c4ef', hash)).toBe(true);
    expect(codeMatches('A2C-4EF', hash)).toBe(true);
    expect(codeMatches(' a2c 4ef ', hash)).toBe(true);
  });

  it('perdona las confusiones que introduce el dictado', () => {
    // Quien oye "cero" teclea 0 aunque el alfabeto no lo use. Rechazarlo sería
    // castigar a la persona por una ambigüedad nuestra.
    expect(codeMatches('QA2CDE', hashCode('0A2CDE'))).toBe(true);
    expect(codeMatches('JJJ222', hashCode('1IL222'))).toBe(true);
    expect(codeMatches('S4B7NP', hashCode('54B7NP'))).toBe(true);
  });

  it('rechaza un código distinto', () => {
    expect(codeMatches('A2C4EF', hashCode('A2C4EG'))).toBe(false);
    expect(codeMatches('', hashCode('A2C4EF'))).toBe(false);
    expect(codeMatches('A2C4E', hashCode('A2C4EF'))).toBe(false);
  });

  it('no acepta un hash con longitud distinta', () => {
    // timingSafeEqual lanza si los búferes difieren en tamaño; la comparación
    // tiene que devolver false, no tumbar la petición.
    expect(() => codeMatches('A2C4EF', 'abc')).not.toThrow();
    expect(codeMatches('A2C4EF', 'abc')).toBe(false);
  });

  it('normaliza descartando cualquier cosa que no sea alfanumérica', () => {
    expect(normalizeCode('a2c-4ef')).toBe(normalizeCode('A2C4EF'));
    expect(normalizeCode('¡A2C 4EF!')).toBe(normalizeCode('A2C4EF'));
  });

  it('agrupa en dos tríos para dictarlo', () => {
    expect(formatCode('A2C4EF')).toBe('A2C-4EF');
  });

  it('no repite códigos con frecuencia apreciable', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 2000; i++) vistos.add(generateVerificationCode());
    // Con ~4.6 × 10⁸ combinaciones, 2000 tiradas casi nunca chocan.
    expect(vistos.size).toBeGreaterThan(1995);
  });
});
