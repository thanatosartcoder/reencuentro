import type { Readable } from 'node:stream';

/**
 * Contrato de almacenamiento de archivos.
 *
 * Existe para que las fotos no vivan obligatoriamente en el disco del servidor.
 * Con almacenamiento local, el volumen de las fotos es el mismo que el de la
 * base de datos: cuando se llena, Postgres deja de poder escribir y se cae todo
 * el sistema, incluidos los reportes de personas desaparecidas. Un adjunto
 * opcional no puede tener el poder de tumbar el registro de una desaparición.
 *
 * El driver local sigue siendo válido para desarrollo y para un despliegue de
 * una sola máquina con volumen dedicado. Producción debería usar S3.
 */
export interface StorageDriver {
  readonly name: string;

  put(key: string, body: Buffer, contentType: string): Promise<void>;

  /**
   * Devuelve un flujo, no un Buffer.
   *
   * Servir una foto leyéndola entera a memoria multiplica el consumo por cada
   * petición concurrente. Con flujo, el proceso solo sostiene el trozo que va
   * pasando hacia la red.
   */
  getStream(key: string): Promise<{ stream: Readable; contentType: string; size?: number }>;

  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  /**
   * Objetos bajo un prefijo, del más nuevo al más viejo.
   *
   * Existe para la retención de respaldos: guardar copias sin poder enumerarlas
   * es acumular coste sin poder podarlo, y borrar por nombre adivinado es
   * borrar lo que no toca.
   */
  list(prefix: string): Promise<{ key: string; size: number; lastModified: Date }[]>;

  /**
   * Espacio libre, si el driver puede saberlo. `null` en almacenamiento de
   * objetos, que es justamente la razón por la que conviene usarlo.
   */
  freeSpaceBytes(): Promise<number | null>;
}

export class StorageObjectNotFound extends Error {
  constructor(key: string) {
    super(`No existe el objeto ${key}`);
  }
}
