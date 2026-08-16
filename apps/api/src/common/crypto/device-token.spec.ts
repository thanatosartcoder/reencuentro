const CLAVE = 'clave-de-pruebas-suficientemente-larga';
// Antes del import: el modulo lee la clave al firmar, y los `describe` de abajo
// emiten tokens al construirse, que es antes de que corra cualquier `beforeAll`.
process.env.DEVICE_TOKEN_SECRET = CLAVE;

import { emitirTokenDeDispositivo, verificarTokenDeDispositivo } from './device-token';

/**
 * La credencial que separa un votante de otro.
 *
 * Antes el `deviceId` lo enviaba el cliente, así que la defensa contra votar
 * muchas veces consistía en preguntarle al votante quién era y creerle. Lo que
 * se fija aquí es que un identificador que el servidor no firmó no pase por uno
 * que sí, en ninguna de sus variantes.
 */

describe('emitirTokenDeDispositivo', () => {
  it('emite identificadores distintos cada vez', () => {
    const a = emitirTokenDeDispositivo();
    const b = emitirTokenDeDispositivo();
    expect(a.deviceId).not.toBe(b.deviceId);
    expect(a.deviceToken).not.toBe(b.deviceToken);
  });

  it('el identificador no dice nada de nadie: 16 bytes al azar', () => {
    expect(emitirTokenDeDispositivo().deviceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('el token que emite, se verifica', () => {
    const { deviceId, deviceToken } = emitirTokenDeDispositivo();
    expect(verificarTokenDeDispositivo(deviceToken)).toBe(deviceId);
  });
});

describe('lo que NO debe verificarse', () => {
  const { deviceToken, deviceId } = emitirTokenDeDispositivo();

  it.each([
    ['ausente', undefined],
    ['vacío', ''],
    ['sin las tres partes', 'd1.abc'],
    ['con versión desconocida', deviceToken.replace(/^d1\./, 'd9.')],
    ['con el id manipulado', deviceToken.replace(deviceId, 'f'.repeat(32))],
    ['con la firma manipulada', deviceToken.slice(0, -4) + 'AAAA'],
    ['inventado entero', `d1.${'0'.repeat(32)}.loquesea`],
    ['con id de longitud incorrecta', `d1.abc.${deviceToken.split('.')[2]}`],
  ])('%s', (_caso, token) => {
    expect(verificarTokenDeDispositivo(token as string | undefined)).toBeNull();
  });

  it('un token firmado con otra clave', () => {
    const ajeno = emitirTokenDeDispositivo().deviceToken;
    process.env.DEVICE_TOKEN_SECRET = 'otra-clave-completamente-distinta';
    expect(verificarTokenDeDispositivo(ajeno)).toBeNull();
    process.env.DEVICE_TOKEN_SECRET = CLAVE;
  });

  it('nunca lanza: un cliente viejo es un voto que no cuenta, no un error', () => {
    // Si lanzara, un cliente sin actualizar convertiria su voto en un 500.
    expect(() => verificarTokenDeDispositivo('basura')).not.toThrow();
    expect(() => verificarTokenDeDispositivo(undefined)).not.toThrow();
  });
});
