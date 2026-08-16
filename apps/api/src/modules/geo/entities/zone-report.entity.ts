import { Column, Entity, Index, OneToMany } from 'typeorm';
import { SyncableEntity } from 'src/common/entities/syncable.entity';
import { GeoLineString, GeoPoint } from 'src/common/geo/geo.util';
import { ReporterRole } from 'src/modules/persons/persons.enums';
import { ZoneReportStatus, ZoneReportType } from '../geo.enums';
import { ZoneReportVote } from './zone-report-vote.entity';

/**
 * Un reporte colaborativo sobre el terreno: una via bloqueada, un albergue
 * abierto, un rescate en curso.
 *
 * El modelo es de eventos, no de estado: nadie "edita" el estado de una via.
 * Cada reporte es una observacion independiente con su propia hora y su propio
 * autor, y la verdad emerge de cuantos observadores coinciden y de que tan
 * reciente es lo que vieron. Eso hace que la sincronizacion offline sea un
 * simple append sin conflictos que resolver.
 */
@Entity('zone_reports')
@Index(['status', 'type'])
@Index(['status', 'reportedAt'])
export class ZoneReport extends SyncableEntity {
  /**
   * Emergencia a la que pertenece este reporte.
   *
   * Obligatorio: una vía cortada no es un hecho permanente del territorio, es
   * un hecho de una emergencia concreta. Sin saber de cuál, no se sabría en qué
   * mapa mostrarla ni cuándo deja de importar.
   */
  @Index()
  @Column({ type: 'uuid' })
  eventId: string;

  @Index()
  @Column({ type: 'enum', enum: ZoneReportType })
  type: ZoneReportType;

  /** Punto de referencia. Siempre presente, incluso si el reporte cubre un tramo. */
  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  location: GeoPoint;

  /**
   * Tramo de via afectado, cuando el usuario dibuja mas que un punto.
   * Un derrumbe que corta 800 metros de carretera no se representa bien con un
   * pin, y el ruteo necesita saber que segmento evitar.
   */
  @Index({ spatial: true })
  @Column({
    type: 'geography',
    spatialFeatureType: 'LineString',
    srid: 4326,
    nullable: true,
  })
  path: GeoLineString | null;

  /** Radio de afectacion en metros, para reportes de area (sin senal, sin energia). */
  @Column({ type: 'int', nullable: true })
  radiusMeters: number | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  roadName: string | null;

  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  department: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  municipality: string | null;

  /** Gravedad observada 1..5. Por defecto la del tipo, ajustable por el usuario. */
  @Column({ type: 'int', default: 3 })
  severity: number;

  // --- Tiempo ---

  @Index()
  @Column({ type: 'timestamptz' })
  reportedAt: Date;

  /**
   * Vida media efectiva en minutos. Se copia del catalogo de tipos al crear el
   * reporte para que un cambio futuro de configuracion no reescriba la historia.
   */
  @Column({ type: 'int' })
  halfLifeMinutes: number;

  /** Vencimiento declarado por el reportante ("este albergue cierra el domingo"). */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  // --- Confianza ---

  /**
   * Confianza inicial 0..1 segun el rol de quien reporta. Un ciudadano anonimo
   * arranca bajo; un rescatista o un funcionario arrancan alto porque estan
   * mirando el sitio con criterio y responden por lo que dicen.
   */
  @Column({ type: 'double precision', default: 0.4 })
  baseConfidence: number;

  @Column({ type: 'int', default: 0 })
  confirmations: number;

  @Column({ type: 'int', default: 0 })
  refutations: number;

  /**
   * Votos de dispositivos sin credencial del servidor.
   *
   * Se guardan aparte y NO entran en la formula de confianza. Siguen siendo
   * informacion —dicen que alguien mas paso por ahi— pero no pueden esconder un
   * reporte, que es lo que ocurria cuando el `deviceId` lo elegia el cliente.
   */
  /**
   * Refutaciones de personal acreditado.
   *
   * Se cuentan aparte porque son las unicas —junto al paso del tiempo— que
   * pueden retirar un peligro del mapa. Ver el suelo en `confidenceSql`.
   */
  @Column({ type: 'int', default: 0 })
  accreditedRefutations: number;

  @Column({ type: 'int', default: 0 })
  unverifiedConfirmations: number;

  @Column({ type: 'int', default: 0 })
  unverifiedRefutations: number;

  /**
   * Ultima vez que alguien confirmo. La confianza decae desde esta fecha, no
   * desde la creacion: una confirmacion reciente "refresca" el reporte igual
   * que en Waze.
   */
  @Column({ type: 'timestamptz' })
  lastConfirmedAt: Date;

  // --- Autoria ---

  @Column({ type: 'enum', enum: ReporterRole, default: ReporterRole.CITIZEN })
  reporterRole: ReporterRole;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reporterOrganization: string | null;

  /**
   * Identificador estable y anonimo del dispositivo. Sirve para evitar que el
   * mismo aparato vote dos veces y para limitar abuso, sin pedir identidad.
   */
  @Index()
  @Column({ type: 'varchar', length: 64 })
  deviceId: string;

  @Index()
  @Column({ type: 'enum', enum: ZoneReportStatus, default: ZoneReportStatus.ACTIVE })
  status: ZoneReportStatus;

  @Column({ type: 'text', nullable: true })
  resolutionNotes: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  photoStorageKey: string | null;

  @OneToMany(() => ZoneReportVote, (vote) => vote.zoneReport)
  votes: ZoneReportVote[];
}
