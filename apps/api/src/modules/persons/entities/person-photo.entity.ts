import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { PhotoOwnerType } from '../persons.enums';
import { MissingPersonReport } from './missing-person-report.entity';
import { SightingReport } from './sighting-report.entity';

/**
 * Foto asociada a un reporte de desaparicion o a un avistamiento.
 *
 * El binario nunca vive en la base: se guarda en disco (o en un bucket) y aqui
 * solo queda la referencia. En campo las fotos entran comprimidas desde el
 * telefono para no agotar el almacenamiento ni la poca banda disponible.
 */
@Entity('person_photos')
@Index(['ownerType', 'missingReportId'])
@Index(['ownerType', 'sightingReportId'])
export class PersonPhoto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  clientUuid: string;

  @Column({ type: 'enum', enum: PhotoOwnerType })
  ownerType: PhotoOwnerType;

  @Column({ type: 'uuid', nullable: true })
  missingReportId: string | null;

  @ManyToOne(() => MissingPersonReport, (report) => report.photos, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'missingReportId' })
  missingReport: MissingPersonReport | null;

  @Column({ type: 'uuid', nullable: true })
  sightingReportId: string | null;

  @ManyToOne(() => SightingReport, (report) => report.photos, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'sightingReportId' })
  sightingReport: SightingReport | null;

  /**
   * Clave dentro del almacenamiento. Es derivada del contenido, no inventada:
   * `photos/ab/cd/<sha256>.jpg`.
   */
  @Column({ type: 'varchar', length: 500 })
  storageKey: string;

  /**
   * SHA-256 de los bytes ya comprimidos.
   *
   * Permite que varios reportes compartan un mismo objeto: en una emergencia la
   * misma foto se sube muchas veces —tres familiares con la imagen que circuló
   * por WhatsApp— y con clave por contenido esos bytes se guardan una sola vez.
   * También es lo que dice si se puede borrar el objeto al eliminar una
   * referencia, o si todavía lo usa otro reporte.
   */
  @Index()
  @Column({ type: 'char', length: 64 })
  contentHash: string;

  @Column({ type: 'varchar', length: 100 })
  mimeType: string;

  /**
   * Variante AVIF de la misma imagen.
   *
   * Se guardan las dos y es el navegador el que elige, con `<picture>`: AVIF
   * donde se soporta, WebP en el resto. Negociar en el servidor mirando la
   * cabecera `Accept` obligaría a consultar la base en cada petición de imagen
   * y a marcar la respuesta con `Vary`, que fragmenta la caché del CDN. Dejar
   * elegir al cliente no cuesta ni una consulta y cachea perfecto.
   *
   * Es null si la variante está desactivada o si su codificación falló: la foto
   * en WebP siempre existe, la AVIF es una mejora opcional.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  avifStorageKey: string | null;

  @Column({ type: 'int', nullable: true })
  avifSizeBytes: number | null;

  @Column({ type: 'int' })
  sizeBytes: number;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  /**
   * Hash perceptual. Detecta que dos reportes subieron literalmente la misma
   * foto (frecuente cuando varios familiares reportan por separado) sin
   * necesidad de invocar al proveedor biometrico.
   */
  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  perceptualHash: string | null;

  /**
   * Vector facial devuelto por el proveedor biometrico, si hay alguno
   * configurado. Se guarda como arreglo para poder comparar sin volver a
   * llamar al servicio externo en cada intento de match.
   */
  @Column({ type: 'jsonb', nullable: true })
  faceDescriptor: number[] | null;

  /** null = todavia no procesada; false = el proveedor no encontro rostro. */
  @Column({ type: 'boolean', nullable: true })
  hasFace: boolean | null;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
