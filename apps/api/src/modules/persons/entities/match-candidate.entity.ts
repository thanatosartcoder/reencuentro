import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { MatchStatus, MatchTier } from '../persons.enums';
import { MissingPersonReport } from './missing-person-report.entity';
import { SightingReport } from './sighting-report.entity';

/** Desglose del score, para que el validador humano vea por que se propuso el match. */
export interface MatchBreakdown {
  document: number | null;
  name: number | null;
  age: number | null;
  sex: number | null;
  geo: number | null;
  time: number | null;
  physical: number | null;
  face: number | null;
  /** Peso efectivo aplicado a cada senal presente. */
  weights: Record<string, number>;
  /** Distancia en metros entre el ultimo punto conocido y el avistamiento. */
  distanceMeters: number | null;
  /** Horas entre la desaparicion y el avistamiento. */
  hoursApart: number | null;
  /** Razones legibles que se muestran en la cola de revision. */
  reasons: string[];
}

/**
 * Un match propuesto entre un reporte de desaparicion y un avistamiento.
 *
 * Nunca se notifica automaticamente. Un candidato nace en PENDING_REVIEW y solo
 * dispara la notificacion a la familia cuando una persona lo confirma: el costo
 * emocional de un falso positivo aqui ("encontramos a su hijo" cuando no es)
 * es demasiado alto para dejarlo en manos de un umbral.
 */
@Entity('match_candidates')
@Unique('uq_match_pair', ['missingReportId', 'sightingReportId'])
@Index(['status', 'score'])
export class MatchCandidate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  missingReportId: string;

  @ManyToOne(() => MissingPersonReport, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'missingReportId' })
  missingReport: MissingPersonReport;

  @Index()
  @Column({ type: 'uuid' })
  sightingReportId: string;

  @ManyToOne(() => SightingReport, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sightingReportId' })
  sightingReport: SightingReport;

  /** Score combinado 0..1. */
  @Column({ type: 'double precision' })
  score: number;

  @Column({ type: 'enum', enum: MatchTier })
  tier: MatchTier;

  @Column({ type: 'jsonb' })
  breakdown: MatchBreakdown;

  @Index()
  @Column({ type: 'enum', enum: MatchStatus, default: MatchStatus.PENDING_REVIEW })
  status: MatchStatus;

  /** Alta prioridad: score muy alto o persona en estado critico. */
  @Column({ type: 'boolean', default: false })
  highPriority: boolean;

  // --- Revision humana ---

  @Column({ type: 'uuid', nullable: true })
  reviewedById: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reviewedByName: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  reviewNotes: string | null;

  /** Momento en que se aviso a quien reporto la desaparicion. */
  @Column({ type: 'timestamptz', nullable: true })
  notifiedAt: Date | null;

  /** Version del algoritmo que genero el score, para poder re-evaluar historicos. */
  @Column({ type: 'varchar', length: 20, default: 'v1' })
  engineVersion: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
