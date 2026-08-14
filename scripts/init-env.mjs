import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Prepara los archivos de entorno de un clon nuevo.
 *
 * Genera además una clave de cifrado real. El `.env.example` trae una clave de
 * ceros que es válida en formato pero no cifra nada útil, y arrancar con ella
 * es justo el tipo de detalle que nadie recuerda cambiar antes de meter datos
 * de verdad.
 *
 * Nunca sobrescribe un archivo existente: perder la clave con la que ya se
 * cifraron datos los deja irrecuperables.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  { example: 'apps/api/.env.example', file: 'apps/api/.env', withKey: true },
  { example: 'apps/web/.env.local.example', file: 'apps/web/.env.local', withKey: false },
];

for (const target of targets) {
  const path = join(root, target.file);

  if (existsSync(path)) {
    console.log(`  ${target.file} ya existe, se deja como está`);
    continue;
  }

  copyFileSync(join(root, target.example), path);

  if (target.withKey) {
    const key = randomBytes(32).toString('hex');
    const content = readFileSync(path, 'utf8').replace(
      /^FIELD_ENCRYPTION_KEY=.*$/m,
      `FIELD_ENCRYPTION_KEY=${key}`,
    );
    writeFileSync(path, content);
    console.log(`  ${target.file} creado con una clave de cifrado nueva`);
  } else {
    console.log(`  ${target.file} creado`);
  }
}

console.log('\nGuarda FIELD_ENCRYPTION_KEY en un lugar seguro: sin ella, los');
console.log('campos cifrados (documento, teléfono, correo) son irrecuperables.');
