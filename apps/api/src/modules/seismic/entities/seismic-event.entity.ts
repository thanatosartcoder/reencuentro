import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GeoPoint } from 'src/common/geo/geo.util';

/**
 * Un evento sísmico tomado de un catálogo externo.
 *
 * No lo produce esta plataforma: se replica desde el USGS para poder mostrarlo
 * en el mapa sin depender de que su servicio esté disponible, y para que los
 * clientes offline lo tengan en caché. Por eso guarda `source` y el id de
 * origen: cuando el SGC publique un feed en vivo se suma como segunda fuente
 * sin cambiar el modelo.
 *
 * Las soluciones de dos redes distintas para un mismo sismo no coinciden: para
 * el evento del 10 de agosto, el USGS calculó 110,3 km de profundidad y el SGC
 * 96 km. No es un error de nadie; son estimaciones independientes. Guardar el
 * origen de cada registro es lo que permite mostrar la diferencia en vez de
 * elegir una en silencio.
 */
@Entity('seismic_events')
@Index(['source', 'externalId'], { unique: true })
@Index(['occurredAt'])
export class SeismicEvent {
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

  /** USGS, SGC, EMSC… */
  @Column({ type: 'varchar', length: 20 })
  source: string;

  /** Identificador del evento en el catálogo de origen (p. ej. `us7000abcd`). */
  @Column({ type: 'varchar', length: 60 })
  externalId: string;

  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  @Column({ type: 'double precision' })
  magnitude: number;

  /** mww, mb, ml… El tipo de magnitud condiciona cómo se compara. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  magnitudeType: string | null;

  @Column({ type: 'double precision', nullable: true })
  depthKm: number | null;

  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  location: GeoPoint;

  /** Descripción del catálogo: "5 km S of San José del Palmar, Colombia". */
  @Column({ type: 'varchar', length: 300, nullable: true })
  place: string | null;

  /** Distancia al epicentro del evento principal, para separar réplicas. */
  @Column({ type: 'double precision', nullable: true })
  distanceToMainshockKm: number | null;

  /** true para el sismo principal del 10 de agosto. */
  @Column({ type: 'boolean', default: false })
  isMainshock: boolean;

  @Column({ type: 'boolean', default: false })
  tsunamiWarning: boolean;

  /** Intensidad percibida reportada por la comunidad (Did You Feel It). */
  @Column({ type: 'double precision', nullable: true })
  communityIntensity: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  detailUrl: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
