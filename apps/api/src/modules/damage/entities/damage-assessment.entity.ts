import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Polígono GeoJSON tal como lo entrega y espera TypeORM en columnas `geography`. */
export interface GeoMultiPolygon {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}

/**
 * Evaluación de daño en una edificación, hecha por un modelo sobre imagen
 * satelital y publicada en el Humanitarian Data Exchange.
 *
 * Es una estimación automática, no una inspección. El Microsoft AI for Good Lab
 * corrió el modelo sobre imágenes de Airbus y Vantor tomadas los días 10 y 12 de
 * agosto, y en Pereira marcó 309 de 35.760 edificaciones. Sirve para orientar
 * dónde mirar primero, no para declarar una casa inhabitable: eso lo dice un
 * ingeniero en sitio. Por eso el modelo guarda el porcentaje de daño estimado y
 * la fecha de la imagen, y la interfaz muestra ambos.
 */
@Entity('damage_assessments')
@Index(['city', 'damaged'])
export class DamageAssessment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Emergencia a la que pertenece este dato.
   *
   * Obligatorio: un dato de contexto sin emergencia no significa nada — no se
   * sabría en qué mapa mostrarlo ni cuándo deja de ser relevante.
   */
  @Index()
  @Column({ type: 'uuid' })
  eventId: string;

  /** Identificador del dataset en HDX, para poder re-ingerir o retirar en bloque. */
  @Index()
  @Column({ type: 'varchar', length: 120 })
  datasetId: string;

  /** Organización que publicó la evaluación. */
  @Column({ type: 'varchar', length: 120 })
  publisher: string;

  /** Proveedor de la imagen satelital analizada: Airbus, Vantor… */
  @Column({ type: 'varchar', length: 60, nullable: true })
  imagerySource: string | null;

  /** Fuente de las huellas de edificación: Overture, Google. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  footprintSource: string | null;

  @Column({ type: 'varchar', length: 120 })
  city: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  department: string | null;

  /** Identificador de la edificación en el catálogo de huellas de origen. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  buildingId: string | null;

  @Column({ type: 'boolean', default: false })
  damaged: boolean;

  /** Proporción de la huella que el modelo clasifica como dañada (0..1). */
  @Column({ type: 'double precision', nullable: true })
  damageRatio: number | null;

  /** Proporción que el modelo no pudo clasificar, casi siempre por nubes. */
  @Column({ type: 'double precision', nullable: true })
  unknownRatio: number | null;

  /**
   * Huella de la edificación. El GeoPackage de origen viene en UTM 18N
   * (EPSG:32618) y se reproyecta a 4326 durante la ingesta con ST_Transform,
   * para que todo el sistema hable un solo sistema de referencia.
   */
  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'MultiPolygon', srid: 4326 })
  footprint: GeoMultiPolygon;

  /** Fecha de la imagen satelital, no la de la ingesta. */
  @Column({ type: 'timestamptz', nullable: true })
  imageryDate: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
