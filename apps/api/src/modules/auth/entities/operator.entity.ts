import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OperatorRole {
  /** Valida candidatos de match. Es el humano en el loop. */
  VALIDATOR = 'VALIDATOR',
  /** Ademas modera reportes de zona y puede fusionar duplicados. */
  COORDINATOR = 'COORDINATOR',
  ADMIN = 'ADMIN',
  /** Solo lectura: prensa, observadores, integraciones. */
  VIEWER = 'VIEWER',
}

/**
 * Personal acreditado (Cruz Roja, UNGRD, Defensa Civil, voluntarios verificados)
 * que opera el panel de validacion. Es el unico rol que requiere autenticacion
 * real: el ciudadano que reporta no necesita cuenta.
 */
@Entity('operators')
export class Operator {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 200 })
  email: string;

  @Column({ type: 'varchar', length: 200 })
  fullName: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  organization: string | null;

  @Column({ type: 'varchar', length: 255, select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: OperatorRole, default: OperatorRole.VALIDATOR })
  role: OperatorRole;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
