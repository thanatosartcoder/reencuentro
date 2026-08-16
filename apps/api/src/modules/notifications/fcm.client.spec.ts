import { createVerify, generateKeyPairSync } from 'node:crypto';
import { construirAssertion, leerCuentaDeServicio } from './fcm.client';

/**
 * Lo que se puede comprobar sin hablar con Google.
 *
 * El envío real necesita una cuenta de servicio y una ida y vuelta a sus
 * servidores, pero las dos piezas que este proyecto escribe —leer la credencial
 * y firmar el JWT que se cambia por un token de acceso— son verificables aquí.
 * Y conviene, porque los dos fallos típicos de esta integración no dan un error
 * que se entienda: una clave privada con los saltos de línea escapados revienta
 * dentro de OpenSSL, y unas reclamaciones mal puestas se traducen en un
 * `invalid_grant` que no dice cuál.
 */

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const cuenta = {
  project_id: 'reencuentro-demo',
  client_email: 'push@reencuentro-demo.iam.gserviceaccount.com',
  private_key: privateKey,
};

describe('leerCuentaDeServicio', () => {
  it('acepta el JSON en crudo', () => {
    expect(leerCuentaDeServicio(JSON.stringify(cuenta))?.project_id).toBe('reencuentro-demo');
  });

  it('acepta el JSON en base64', () => {
    // Es la forma recomendada: la clave privada lleva saltos de línea y pegarla
    // tal cual en el panel de una plataforma es como llega rota.
    const b64 = Buffer.from(JSON.stringify(cuenta)).toString('base64');
    expect(leerCuentaDeServicio(b64)?.client_email).toBe(cuenta.client_email);
  });

  it('deshace los saltos de línea escapados de la clave', () => {
    const escapada = { ...cuenta, private_key: '-----BEGIN X-----\\nabc\\n-----END X-----' };
    const leida = leerCuentaDeServicio(JSON.stringify(escapada));
    expect(leida?.private_key).toBe('-----BEGIN X-----\nabc\n-----END X-----');
    expect(leida?.private_key).not.toContain('\\n');
  });

  it('sin configurar devuelve null en vez de lanzar', () => {
    // El push es opcional: que no esté no puede impedir arrancar la API.
    expect(leerCuentaDeServicio(undefined)).toBeNull();
    expect(leerCuentaDeServicio('   ')).toBeNull();
  });

  it('avisa con claridad si falta un campo', () => {
    const sinClave = { project_id: 'x', client_email: 'y' };
    expect(() => leerCuentaDeServicio(JSON.stringify(sinClave))).toThrow(/private_key/);
  });

  it('avisa con claridad si no es un JSON', () => {
    expect(() => leerCuentaDeServicio('esto-no-es-nada')).toThrow(/JSON válido/);
  });
});

describe('construirAssertion', () => {
  const ahora = 1_800_000_000;
  const partes = () => construirAssertion(cuenta, ahora).split('.');

  it('firma con RS256', () => {
    const cabecera = JSON.parse(Buffer.from(partes()[0], 'base64url').toString('utf8'));
    expect(cabecera).toEqual({ alg: 'RS256', typ: 'JWT' });
  });

  it('pide exactamente el permiso de mensajería, y solo ese', () => {
    const claims = JSON.parse(Buffer.from(partes()[1], 'base64url').toString('utf8'));
    expect(claims.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    expect(claims.iss).toBe(cuenta.client_email);
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
  });

  it('caduca en una hora, que es el máximo que acepta Google', () => {
    const claims = JSON.parse(Buffer.from(partes()[1], 'base64url').toString('utf8'));
    expect(claims.iat).toBe(ahora);
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it('la firma verifica contra la clave pública', () => {
    // La comprobación que de verdad importa: que lo firmado sea lo que se envía
    // y que la firma sea válida. Si esto falla, Google responde `invalid_grant`
    // y el push deja de salir sin que nada más lo delate.
    const [cabecera, claims, firma] = partes();
    const valida = createVerify('RSA-SHA256')
      .update(`${cabecera}.${claims}`)
      .verify(publicKey, Buffer.from(firma, 'base64url'));
    expect(valida).toBe(true);
  });

  it('una firma manipulada no verifica', () => {
    const [cabecera, claims, firma] = partes();
    const otras = Buffer.from(JSON.stringify({ iss: 'atacante' })).toString('base64url');
    const valida = createVerify('RSA-SHA256')
      .update(`${cabecera}.${otras}`)
      .verify(publicKey, Buffer.from(firma, 'base64url'));
    expect(valida).toBe(false);
  });
});
