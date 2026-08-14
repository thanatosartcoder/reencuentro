import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { StorageDriver } from './storage.types';
import { LocalStorageDriver } from './local-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';

/**
 * Almacenamiento direccionable por contenido.
 *
 * La clave de un archivo es el SHA-256 de sus bytes, no un identificador
 * inventado. Tres consecuencias, todas útiles aquí:
 *
 * 1. **Deduplicación real.** En una emergencia la misma foto se sube muchas
 *    veces: tres familiares reportan a la misma persona con la foto que
 *    circuló por WhatsApp, y un rescatista vuelve a subir la que ya mandó. Con
 *    clave por contenido, esos bytes se guardan una sola vez, sin importar
 *    cuántos reportes los referencien.
 *
 * 2. **Caché permanente.** La clave no puede cambiar de contenido, así que el
 *    objeto se marca inmutable y el CDN lo sirve para siempre sin volver a
 *    pedirlo. Es lo que evita que cada vista del listado sea una lectura
 *    facturable.
 *
 * 3. **Integridad verificable.** Recalcular el hash de lo almacenado dice si
 *    los bytes siguen siendo los que se subieron.
 *
 * La clave se reparte en dos niveles de dos caracteres para no dejar cien mil
 * archivos en un solo directorio, que degrada el driver local.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private driver!: StorageDriver;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const provider = this.config.get<string>('storage.provider') ?? 'local';

    if (provider === 's3') {
      const bucket = this.config.get<string>('storage.s3.bucket');
      const accessKeyId = this.config.get<string>('storage.s3.accessKeyId');
      const secretAccessKey = this.config.get<string>('storage.s3.secretAccessKey');

      if (!bucket || !accessKeyId || !secretAccessKey) {
        // Se cae al arranque en vez de silenciosamente al disco: descubrir en
        // producción que las fotos llevan una semana yendo al contenedor, y no
        // al bucket, es peor que no arrancar.
        throw new Error(
          'STORAGE_PROVIDER=s3 requiere S3_BUCKET, S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY',
        );
      }

      this.driver = new S3StorageDriver({
        endpoint: this.config.get<string>('storage.s3.endpoint') || undefined,
        region: this.config.get<string>('storage.s3.region') ?? 'auto',
        bucket,
        accessKeyId,
        secretAccessKey,
      });
    } else {
      this.driver = new LocalStorageDriver(
        this.config.get<string>('storage.localDir') ?? './uploads',
      );
    }

    this.logger.log(`Almacenamiento de fotos: ${this.driver.name}`);

    if (this.driver.name === 'local' && this.config.get('nodeEnv') === 'production') {
      this.logger.warn(
        'Almacenamiento local en producción: las fotos comparten volumen con la base de datos. ' +
          'Si se llena, Postgres deja de escribir y se cae todo el sistema. Usa STORAGE_PROVIDER=s3.',
      );
    }
  }

  /** SHA-256 en hexadecimal de los bytes ya comprimidos. */
  static hashContent(body: Buffer): string {
    return createHash('sha256').update(body).digest('hex');
  }

  /** Clave repartida: `photos/ab/cd/abcd…ef.jpg`. */
  static keyFor(contentHash: string, extension = 'jpg'): string {
    return `photos/${contentHash.slice(0, 2)}/${contentHash.slice(2, 4)}/${contentHash}.${extension}`;
  }

  /**
   * Guarda los bytes bajo su hash, o no hace nada si ya estaban.
   *
   * `deduplicated` le dice a quien llama que no se escribió nada nuevo, que es
   * información útil: en almacenamiento de objetos cada escritura se factura.
   */
  async putContent(
    body: Buffer,
    contentType = 'image/webp',
    extension = 'webp',
  ): Promise<{ key: string; contentHash: string; deduplicated: boolean }> {
    const contentHash = StorageService.hashContent(body);
    const key = StorageService.keyFor(contentHash, extension);

    if (await this.driver.exists(key)) {
      return { key, contentHash, deduplicated: true };
    }

    await this.driver.put(key, body, contentType);
    return { key, contentHash, deduplicated: false };
  }

  getStream(key: string) {
    return this.driver.getStream(key);
  }

  delete(key: string) {
    return this.driver.delete(key);
  }

  exists(key: string) {
    return this.driver.exists(key);
  }

  get driverName(): string {
    return this.driver.name;
  }

  /**
   * Si queda espacio para aceptar una subida.
   *
   * Solo aplica al driver local. Se reserva un margen porque el disco lo
   * comparte la base de datos: quedarse sin espacio por fotos impediría
   * registrar una desaparición, y un adjunto opcional no puede tener ese poder.
   */
  async hasRoomFor(bytes: number): Promise<{ ok: boolean; freeBytes: number | null }> {
    const free = await this.driver.freeSpaceBytes();
    if (free === null) return { ok: true, freeBytes: null };

    const reserve = this.config.get<number>('storage.minFreeBytes') ?? 2 * 1024 ** 3;
    return { ok: free - bytes > reserve, freeBytes: free };
  }
}
