import {
  blindIndex,
  decryptField,
  encryptField,
  keyIdOf,
  keyringInfo,
  resetKeyringCache,
} from './field-crypto';

const K1 = '11'.repeat(32);
const K2 = '22'.repeat(32);
const K3 = '33'.repeat(32);

function entorno(vars: Record<string, string | undefined>): void {
  for (const k of [
    'FIELD_ENCRYPTION_KEY',
    'FIELD_ENCRYPTION_KEYS',
    'FIELD_ENCRYPTION_ACTIVE',
    'FIELD_INDEX_KEY',
  ]) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) process.env[k] = v;
  }
  resetKeyringCache();
}

describe('cifrado de campos con llavero de claves', () => {
  afterEach(() => entorno({ FIELD_ENCRYPTION_KEY: K1 }));

  it('sigue funcionando con la variable antigua, como v1', () => {
    entorno({ FIELD_ENCRYPTION_KEY: K1 });
    expect(keyringInfo()).toEqual({ ids: ['v1'], activeId: 'v1' });

    const cifrado = encryptField('1088234567');
    expect(keyIdOf(cifrado)).toBe('v1');
    expect(decryptField(cifrado)).toBe('1088234567');
  });

  it('descifra lo cifrado con una clave vieja después de rotar', () => {
    // Un despliegue que llevaba tiempo con v1…
    entorno({ FIELD_ENCRYPTION_KEY: K1 });
    const viejo = encryptField('3001234567');

    // …y ahora rota a v2 manteniendo v1 en el llavero.
    entorno({
      FIELD_ENCRYPTION_KEYS: `v1:${K1},v2:${K2}`,
      FIELD_ENCRYPTION_ACTIVE: 'v2',
    });

    // Lo viejo se sigue leyendo. Esto es lo que permite rotar sin parar nada.
    expect(decryptField(viejo)).toBe('3001234567');

    // Y lo nuevo ya sale con la clave nueva.
    const nuevo = encryptField('3001234567');
    expect(keyIdOf(nuevo)).toBe('v2');
    expect(decryptField(nuevo)).toBe('3001234567');
  });

  it('avisa con claridad si se retira una clave que todavía se usaba', () => {
    entorno({ FIELD_ENCRYPTION_KEY: K1 });
    const viejo = encryptField('secreto');

    // Se saca v1 del llavero antes de reescribir lo que quedaba con ella.
    entorno({ FIELD_ENCRYPTION_KEYS: `v2:${K2}`, FIELD_ENCRYPTION_ACTIVE: 'v2' });

    expect(() => decryptField(viejo)).toThrow(/clave "v1".*no está en el llavero/);
  });

  it('rechaza un llavero con una clave de tamaño incorrecto', () => {
    entorno({ FIELD_ENCRYPTION_KEYS: 'v1:abcd' });
    expect(() => encryptField('x')).toThrow(/32 bytes/);
  });

  it('rechaza que la clave activa no esté en el llavero', () => {
    entorno({ FIELD_ENCRYPTION_KEYS: `v1:${K1}`, FIELD_ENCRYPTION_ACTIVE: 'v9' });
    expect(() => encryptField('x')).toThrow(/no está en el llavero/);
  });

  it('no produce dos veces el mismo ciphertext para el mismo valor', () => {
    entorno({ FIELD_ENCRYPTION_KEY: K1 });
    // El IV es aleatorio: si dos cédulas iguales dieran el mismo ciphertext,
    // cualquiera con acceso a la base sabría que son la misma sin descifrar.
    expect(encryptField('1088234567')).not.toBe(encryptField('1088234567'));
  });

  it('detecta un ciphertext manipulado', () => {
    entorno({ FIELD_ENCRYPTION_KEY: K1 });
    const cifrado = encryptField('1088234567');
    const partes = cifrado.split('.');
    partes[3] = Buffer.from('otra cosa').toString('base64url');
    expect(() => decryptField(partes.join('.'))).toThrow();
  });
});

describe('índice ciego', () => {
  afterEach(() => entorno({ FIELD_ENCRYPTION_KEY: K1 }));

  it('NO cambia al rotar la clave de cifrado', () => {
    // Es la garantía que sostiene el motor de coincidencias: compara el hash
    // del reporte con el del avistamiento. Si rotar cambiara el índice, dos
    // reportes de la misma persona dejarían de reconocerse y una familia no
    // recibiría el aviso.
    entorno({ FIELD_ENCRYPTION_KEY: K1 });
    const antes = blindIndex('1088234567');

    entorno({
      FIELD_ENCRYPTION_KEYS: `v1:${K1},v2:${K2}`,
      FIELD_ENCRYPTION_ACTIVE: 'v2',
    });
    expect(blindIndex('1088234567')).toBe(antes);

    entorno({
      FIELD_ENCRYPTION_KEYS: `v1:${K1},v2:${K2},v3:${K3}`,
      FIELD_ENCRYPTION_ACTIVE: 'v3',
    });
    expect(blindIndex('1088234567')).toBe(antes);
  });

  it('es estable y distinto por valor', () => {
    entorno({ FIELD_ENCRYPTION_KEY: K1 });
    expect(blindIndex('1088234567')).toBe(blindIndex('1088234567'));
    expect(blindIndex('1088234567')).not.toBe(blindIndex('1088234568'));
    expect(blindIndex('1088234567')).toHaveLength(64);
  });

  it('solo cambia si se cambia su propia clave, a propósito', () => {
    entorno({ FIELD_ENCRYPTION_KEY: K1 });
    const conV1 = blindIndex('1088234567');

    entorno({ FIELD_ENCRYPTION_KEY: K1, FIELD_INDEX_KEY: K3 });
    expect(blindIndex('1088234567')).not.toBe(conV1);
  });

  it('no coincide con el ciphertext ni lo revela', () => {
    entorno({ FIELD_ENCRYPTION_KEY: K1 });
    const valor = '1088234567';
    expect(encryptField(valor)).not.toContain(blindIndex(valor));
  });
});
