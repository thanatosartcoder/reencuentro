import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export interface GeoLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

/**
 * Tramo de vía del export de OpenStreetMap que HOT publicó para esta emergencia.
 *
 * Esto NO dice si la vía está transitable —eso lo reportan las personas en
 * `zone_reports`— sino qué vías existen y cómo se llaman. Es la diferencia
 * entre un mapa que dibuja carreteras como píxeles y uno que puede razonar
 * sobre ellas: buscar una vía por nombre, saber cuántos kilómetros conectan un
 * municipio, o pegar el reporte de un derrumbe al segmento real en vez de a una
 * línea dibujada a pulso.
 *
 * Importa especialmente en Chocó. Las teselas del mapa base vienen de un
 * extracto de OSM que puede tener meses; este export es del 13 de agosto de
 * 2026 e incluye lo que la comunidad humanitaria mapeó DESPUÉS del sismo, que
 * es justo la zona donde el mapa base está más vacío.
 *
 * Licencia: ODbL. Cualquier uso debe atribuir a los colaboradores de
 * OpenStreetMap.
 */
@Entity('road_segments')
@Index(['highway'])
@Index(['name'])
export class RoadSegment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Descarga de la que salió este tramo.
   *
   * Las vías no pertenecen a una emergencia —la geografía es la misma para
   * todas— pero sí a la descarga concreta que las trajo. Es lo que permite
   * recargar un dataset regional sin borrar los otros.
   */
  @Index()
  @Column({ type: 'varchar', length: 160 })
  datasetId: string;

  /** Identificador del `way` en OpenStreetMap. Permite reconciliar con el origen. */
  @Index({ unique: true })
  @Column({ type: 'bigint' })
  osmId: string;

  /** Clasificación OSM: trunk, primary, secondary, tertiary, residential, track… */
  @Column({ type: 'varchar', length: 40 })
  highway: string;

  @Column({ type: 'varchar', length: 250, nullable: true })
  name: string | null;

  /** paved, unpaved, gravel, dirt… Decide si pasa un carro o solo un 4x4. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  surface: string | null;

  /** Un puente sobre una vía cortada es un punto único de fallo. */
  @Column({ type: 'boolean', default: false })
  isBridge: boolean;

  @Column({ type: 'boolean', default: false })
  isTunnel: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  oneway: string | null;

  /** Longitud en metros, calculada por PostGIS al insertar. */
  @Column({ type: 'double precision', nullable: true })
  lengthMeters: number | null;

  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'LineString', srid: 4326 })
  path: GeoLineString;

  /** Fecha del export de HOT, no de la ingesta. */
  @Column({ type: 'timestamptz', nullable: true })
  exportedAt: Date | null;
}
