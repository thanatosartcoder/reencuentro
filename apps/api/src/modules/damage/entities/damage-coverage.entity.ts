import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export interface GeoPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

/**
 * Área que un modelo de daño alcanzó a analizar.
 *
 * Existe para poder distinguir dos cosas que en un mapa se ven idénticas:
 * "aquí se miró y no se encontró daño" y "aquí nadie ha mirado".
 *
 * Sin esta capa, Chocó —el departamento del epicentro, con vías cortadas y
 * fallas de comunicación— aparece exactamente igual que una zona intacta:
 * vacío. Y esa lectura es justo la contraria a la realidad, porque el mismo
 * aislamiento que impide evaluarlo es el que hace probable que esté peor. La
 * ausencia de dato nunca puede presentarse como ausencia de daño.
 */
@Entity('damage_coverage')
export class DamageCoverage {
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

  @Index()
  @Column({ type: 'varchar', length: 120 })
  datasetId: string;

  @Column({ type: 'varchar', length: 120 })
  city: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  department: string | null;

  @Column({ type: 'varchar', length: 120 })
  publisher: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  imagerySource: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  imageryDate: Date | null;

  /** Total de edificaciones que el modelo evaluó dentro de esta área. */
  @Column({ type: 'int', nullable: true })
  buildingsAssessed: number | null;

  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'Polygon', srid: 4326 })
  area: GeoPolygon;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
