import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { StorageDriver } from './storage.types';
import { StorageObjectNotFound } from './storage.types';

/**
 * Almacenamiento en un servicio compatible con S3.
 *
 * Se usa el protocolo de S3 y no un SDK propietario para que el proveedor sea
 * una decisión reversible: R2, B2, MinIO autoalojado o el propio S3 funcionan
 * con la misma configuración cambiando el endpoint. En una plataforma de
 * emergencia, quedar atado a un proveedor es un riesgo operativo, no solo
 * comercial.
 *
 * Lo importante frente al disco local: el volumen de las fotos deja de ser el
 * volumen de la base de datos. Que se llene de fotos ya no puede impedir que
 * Postgres escriba un reporte de desaparición.
 */
export class S3StorageDriver implements StorageDriver {
  readonly name: string;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: {
    endpoint?: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    /** R2 y MinIO requieren rutas con el bucket en el path, no en el subdominio. */
    forcePathStyle?: boolean;
  }) {
    this.bucket = options.bucket;
    this.name = options.endpoint ? `s3(${new URL(options.endpoint).host})` : 's3';

    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Las fotos ya vienen recomprimidas y su clave es inmutable, así que
        // pueden cachearse indefinidamente en el CDN. Es lo que evita que cada
        // vista del listado se convierta en una lectura facturable.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async getStream(key: string) {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!response.Body) throw new StorageObjectNotFound(key);

      return {
        stream: response.Body as Readable,
        contentType: response.ContentType ?? 'image/jpeg',
        size: response.ContentLength,
      };
    } catch (error) {
      if (error instanceof StorageObjectNotFound) throw error;
      throw new StorageObjectNotFound(key);
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /** El almacenamiento de objetos no tiene un límite que agotar. Ese es el punto. */
  async freeSpaceBytes(): Promise<number | null> {
    return null;
  }
}
