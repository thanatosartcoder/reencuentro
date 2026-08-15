import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { GeoPoint } from 'src/common/geo/geo.util';

/**
 * Una emergencia concreta.
 *
 * Hasta ahora el sismo del 10 de agosto vivía como constantes en el código y
 * todo pertenecía implícitamente a él. Esto lo convierte en una fila, para
 * poder cubrir la siguiente sin desplegar una copia entera de la plataforma.
 *
 * ## Qué vive aquí y qué no
 *
 * Aquí va lo que las **consultas** necesitan: dónde ocurrió, cuándo, con qué
 * radio se buscan réplicas y qué área cubre. Son datos que la base tiene que
 * poder filtrar y cruzar espacialmente.
 *
 * Las **cifras oficiales** —muertos, desaparecidos, viviendas destruidas— se
 * quedan en código, indexadas por `slug`. Vienen de la UNGRD y la Fiscalía y
 * tienen que poder auditarse contra su fuente: en git cada corrección queda con
 * su fecha y su origen, mientras que en una tabla se sobrescribiría sin rastro.
 * Esa distinción es deliberada y conviene mantenerla al añadir eventos.
 *
 * ## Lo que este modelo NO hace
 *
 * No aísla a las personas. Los reportes de desaparición y los avistamientos
 * llevan el evento como **etiqueta de contexto**, no como partición: alguien
 * reportado tras este sismo puede ser visto un año después durante otra
 * emergencia, y el motor de coincidencias tiene que poder proponerlo. Las
 * desapariciones no terminan cuando termina la emergencia.
 */
export enum EventKind {
  EARTHQUAKE = 'EARTHQUAKE',
  FLOOD = 'FLOOD',
  LANDSLIDE = 'LANDSLIDE',
  STORM = 'STORM',
  OTHER = 'OTHER',
}

export enum EventStatus {
  /** Emergencia en curso: se reciben reportes y se ingieren fuentes. */
  ACTIVE = 'ACTIVE',
  /** Ya no es aguda, pero sigue habiendo casos abiertos. */
  MONITORING = 'MONITORING',
  /** Cerrada. Se conserva para consulta y para los casos sin resolver. */
  CLOSED = 'CLOSED',
}

@Entity('events')
export class EventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Identificador legible y estable: `sismo-san-jose-del-palmar-2026`.
   *
   * Es lo que enlaza esta fila con sus cifras oficiales en código y lo que
   * aparecerá en la URL. No se renombra: un enlace compartido por WhatsApp en
   * una emergencia sigue circulando meses después.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  slug: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'enum', enum: EventKind, default: EventKind.OTHER })
  kind: EventKind;

  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  /**
   * Epicentro. Nulo a propósito: una inundación o un deslizamiento no lo tiene,
   * y forzar un punto inventaría precisión que no existe.
   */
  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326, nullable: true })
  epicenter: GeoPoint | null;

  /** Radio de interés alrededor del epicentro. Acota la búsqueda de réplicas. */
  @Column({ type: 'integer', nullable: true })
  searchRadiusKm: number | null;

  /** Departamentos afectados, para acotar ingestas y filtros. */
  @Column({ type: 'text', array: true, default: '{}' })
  departments: string[];

  @Index()
  @Column({ type: 'enum', enum: EventStatus, default: EventStatus.ACTIVE })
  status: EventStatus;

  /**
   * El que se muestra al entrar sin elegir nada.
   *
   * Uno solo puede tenerlo: hay un índice parcial único que lo garantiza en la
   * base, no solo en el código. Sin esa restricción, dos eventos marcados a la
   * vez harían que la portada mostrara uno u otro según el orden de la
   * consulta, que es la clase de fallo que nadie reproduce.
   */
  @Column({ type: 'boolean', default: false })
  isPrimary: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
