import { generateKeyPairSync } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { cifrarCopia, descifrarCopia, leerClavePublica } from './backup-crypto';

/**
 * El ciclo completo: sellar y volver a abrir.
 *
 * Cifrar una copia sin un camino probado de vuelta no es proteger los datos, es
 * perderlos despacio — y con la particularidad de que no se nota hasta el día en
 * que hacen falta, que es el peor día posible para descubrirlo. Por eso lo que
 * se prueba aquí no es que el cifrado "funcione" sino que un volcado entra y
 * sale idéntico.
 */

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const otra = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

describe('leerClavePublica', () => {
  it('acepta el PEM en crudo', () => {
    expect(leerClavePublica(publicKey)).toContain('BEGIN PUBLIC KEY');
  });

  it('acepta el PEM en base64', () => {
    // Un PEM lleva saltos de línea; pegarlo en el panel de una plataforma es
    // como llega roto.
    const b64 = Buffer.from(publicKey).toString('base64');
    expect(leerClavePublica(b64)).toContain('BEGIN PUBLIC KEY');
  });

  it('sin configurar devuelve null en vez de lanzar', () => {
    // Un despliegue de desarrollo no necesita cifrar sus volcados, y exigirlo
    // solo conseguiría que alguien apagara las copias enteras.
    expect(leerClavePublica(undefined)).toBeNull();
    expect(leerClavePublica('  ')).toBeNull();
  });

  it('rechaza una clave que no lo es', () => {
    expect(() => leerClavePublica('-----BEGIN PUBLIC KEY-----\nno\n-----END PUBLIC KEY-----'))
      .toThrow(/clave pública válida/);
  });

  it('rechaza una clave PRIVADA puesta por error donde va la pública', () => {
    // El error que dejaría la privada en el servidor, que es justo lo que este
    // diseño evita.
    expect(() => leerClavePublica(privateKey)).toThrow(/clave PRIVADA/);
  });
});

describe('ciclo completo de una copia', () => {
  const volcado = gzipSync(
    Buffer.from(
      Array.from({ length: 2000 }, (_, i) => `INSERT INTO personas VALUES (${i}, 'Ñandú áéí');`)
        .join('\n'),
    ),
  );

  it('lo que entra vuelve a salir idéntico', () => {
    const sellada = cifrarCopia(volcado, publicKey);
    expect(descifrarCopia(sellada, privateKey).equals(volcado)).toBe(true);
  });

  it('y el SQL de dentro se descomprime bien', () => {
    const sellada = cifrarCopia(volcado, publicKey);
    const sql = gunzipSync(descifrarCopia(sellada, privateKey)).toString('utf8');
    expect(sql).toContain("INSERT INTO personas VALUES (1999, 'Ñandú áéí');");
  });

  it('el archivo sellado no contiene el texto en claro', () => {
    // La comprobación obvia que conviene tener escrita: si esto fallara, todo lo
    // demás daría igual.
    const sellada = cifrarCopia(gzipSync(Buffer.from('documento 1032456789')), publicKey);
    expect(sellada.includes(Buffer.from('1032456789'))).toBe(false);
  });

  it('cada copia usa una clave distinta', () => {
    // Dos copias del mismo contenido no pueden salir iguales: si lo fueran,
    // comparar dos archivos revelaría que la base no cambió entre ambas.
    const a = cifrarCopia(volcado, publicKey);
    const b = cifrarCopia(volcado, publicKey);
    expect(a.equals(b)).toBe(false);
  });
});

describe('lo que no debe poder abrirse', () => {
  const sellada = cifrarCopia(gzipSync(Buffer.from('datos')), publicKey);

  it('con la clave privada equivocada', () => {
    expect(() => descifrarCopia(sellada, otra.privateKey)).toThrow();
  });

  it('si el archivo fue alterado', () => {
    // GCM detecta la manipulación. Sin esto se devolvería basura con pinta de
    // volcado, y una copia corrupta en silencio es peor que ninguna.
    const tocada = Buffer.from(sellada);
    tocada[tocada.length - 5] ^= 0xff;
    expect(() => descifrarCopia(tocada, privateKey)).toThrow();
  });

  it('si el archivo se truncó al descargarlo', () => {
    expect(() => descifrarCopia(sellada.subarray(0, sellada.length - 20), privateKey)).toThrow();
  });

  it('una copia antigua sin cifrar avisa de qué hacer', () => {
    expect(() => descifrarCopia(gzipSync(Buffer.from('viejo')), privateKey))
      .toThrow(/gunzip/);
  });
});
