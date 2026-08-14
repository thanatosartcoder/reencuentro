import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum IngestSource {
  HDX_DAMAGE = 'HDX_DAMAGE',
  HOT_ROADS = 'HOT_ROADS',
}

export enum IngestStatus {
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  /** La fuente no había cambiado: no se descargó nada. */
  SKIPPED = 'SKIPPED',
  FAILED = 'FAILED',
}

/**
 * Bitácora de las ingestas de fuentes externas.
 *
 * Cumple tres funciones y ninguna es decorativa:
 *
 * 1. Guarda la versión de la fuente ya cargada, para no volver a descargar
 *    160 MB cada noche cuando HDX no ha publicado nada nuevo.
 * 2. Permite decirle a quien usa el mapa cuándo se actualizó cada capa. Un dato
 *    externo sin fecha de carga es un dato en el que no se puede confiar.
 * 3. Deja rastro de los fallos. Una ingesta que lleva cuatro noches cayendo en
 *    silencio produce un mapa que parece al día y no lo está.
 */
@Entity('ingest_runs')
@Index(['source', 'startedAt'])
export class IngestRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'enum', enum: IngestSource })
  source: IngestSource;

  @Column({ type: 'enum', enum: IngestStatus })
  status: IngestStatus;

  /**
   * Identificador de versión que publica la fuente (para HDX, su
   * `metadata_modified`). Es lo que se compara para decidir si hay algo nuevo.
   */
  @Column({ type: 'varchar', length: 120, nullable: true })
  sourceVersion: string | null;

  @Column({ type: 'int', nullable: true })
  recordsLoaded: number | null;

  @Column({ type: 'int', nullable: true })
  bytesDownloaded: number | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** Si la disparó el cron o una persona desde la consola o el panel. */
  @Column({ type: 'varchar', length: 20, default: 'cron' })
  trigger: 'cron' | 'manual';

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  durationSeconds: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
