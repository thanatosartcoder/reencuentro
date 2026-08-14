import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Bitacora de acceso a datos personales.
 *
 * El sistema guarda fotos, ubicaciones y datos de menores desaparecidos. La Ley
 * 1581 de 2012 exige poder demostrar quien vio o modifico esos datos y cuando,
 * asi que toda lectura de un reporte completo y toda decision de validacion
 * dejan rastro. Es tabla de solo insercion.
 */
@Entity('audit_logs')
@Index(['entityType', 'entityId'])
@Index(['actorId', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Operador autenticado, o null si fue un acceso publico/anonimo. */
  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  actorName: string | null;

  /** VIEW_PII, CONFIRM_MATCH, REJECT_MATCH, MERGE_REPORT, MODERATE_ZONE, EXPORT. */
  @Index()
  @Column({ type: 'varchar', length: 60 })
  action: string;

  @Column({ type: 'varchar', length: 60 })
  entityType: string;

  @Column({ type: 'uuid', nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @Column({ type: 'varchar', length: 60, nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
