import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile, rename } from 'node:fs/promises';
import { statfs } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { StorageDriver } from './storage.types';
import { StorageObjectNotFound } from './storage.types';

const CONTENT_TYPES: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  avif: 'image/avif',
  png: 'image/png',
};

function contentTypeFor(key: string): string {
  const extension = key.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * Almacenamiento en el disco del servidor.
 *
 * Vale para desarrollo y para un despliegue de una sola máquina con volumen
 * dedicado. No vale para producción con varias instancias —cada una vería solo
 * sus propias fotos— ni para un volumen compartido con la base de datos.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /**
   * Resuelve una clave a una ruta, impidiendo salir del directorio raíz.
   *
   * Sin esta comprobación una clave como `../../.env` leería archivos fuera del
   * almacenamiento de fotos.
   */
  private pathFor(key: string): string {
    const target = resolve(this.root, normalize(key));
    if (target !== this.root && !target.startsWith(this.root + '/')) {
      throw new StorageObjectNotFound(key);
    }
    return target;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });

    // Se escribe a un temporal y se renombra: el rename es atómico dentro del
    // mismo sistema de archivos, así que nadie puede leer un archivo a medio
    // escribir si el proceso muere en mitad de la subida.
    const temp = join(dirname(path), `.${randomBytes(8).toString('hex')}.tmp`);
    await writeFile(temp, body);
    await rename(temp, path);
  }

  async getStream(key: string) {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      return {
        stream: createReadStream(path),
        // El tipo sale de la extensión de la clave: el formato de salida es
        // configurable y devolver siempre image/jpeg serviría un WebP mal
        // etiquetado.
        contentType: contentTypeFor(key),
        size: info.size,
      };
    } catch {
      throw new StorageObjectNotFound(key);
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async freeSpaceBytes(): Promise<number | null> {
    try {
      await mkdir(this.root, { recursive: true });
      const fs = await statfs(this.root);
      return fs.bavail * fs.bsize;
    } catch {
      return null;
    }
  }

  async list(prefix: string) {
    // El prefijo puede apuntar a una carpeta o ser un fragmento de nombre; se
    // recorre desde el directorio que lo contiene y se filtra por la clave
    // completa, igual que hace el almacenamiento de objetos.
    const base = prefix.endsWith('/') ? prefix : prefix.replace(/[^/]*$/, '');
    const dir = this.pathFor(base || '.');

    const objetos: { key: string; size: number; lastModified: Date }[] = [];

    const walk = async (absolute: string, relative: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(absolute, { withFileTypes: true });
      } catch {
        return; // La carpeta no existe todavía: no hay nada que listar.
      }

      for (const entry of entries) {
        const key = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(join(absolute, entry.name), key);
          continue;
        }
        if (!key.startsWith(prefix)) continue;
        const info = await stat(join(absolute, entry.name));
        objetos.push({ key, size: info.size, lastModified: info.mtime });
      }
    };

    await walk(dir, base.replace(/\/$/, ''));
    return objetos.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  }
}
