import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { GeoPoint } from 'src/common/geo/geo.util';
import { ReporterRole } from 'src/modules/persons/persons.enums';
import { VoteKind } from '../geo.enums';
import { ZoneReport } from './zone-report.entity';

/**
 * "Sigue así" / "ya no". Un dispositivo vota una sola vez por reporte; si
 * cambia de opinion se actualiza su voto en lugar de sumar uno nuevo.
 */
@Entity('zone_report_votes')
@Unique('uq_vote_per_device', ['zoneReportId', 'deviceId'])
export class ZoneReportVote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  clientUuid: string;

  @Index()
  @Column({ type: 'uuid' })
  zoneReportId: string;

  @ManyToOne(() => ZoneReport, (report) => report.votes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'zoneReportId' })
  zoneReport: ZoneReport;

  @Column({ type: 'enum', enum: VoteKind })
  vote: VoteKind;

  @Column({ type: 'varchar', length: 64 })
  deviceId: string;

  /**
   * Si el `deviceId` venia firmado por el servidor.
   *
   * Un voto sin firma cuenta como senal de la comunidad pero no baja la
   * confianza: si lo hiciera, inventarse identificadores bastaria para esconder
   * del mapa una via cortada.
   */
  @Column({ type: 'boolean', default: false })
  verified: boolean;

  /** Si quien voto tenia sesion en el panel. Ver `accreditedRefutations`. */
  @Column({ type: 'boolean', default: false })
  accredited: boolean;

  @Column({ type: 'enum', enum: ReporterRole, default: ReporterRole.CITIZEN })
  voterRole: ReporterRole;

  /**
   * Desde donde se emitio el voto. Un "sigue bloqueada" a 40 km de distancia
   * vale menos que uno emitido frente al derrumbe.
   */
  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  location: GeoPoint | null;

  @Column({ type: 'int', nullable: true })
  distanceMeters: number | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
