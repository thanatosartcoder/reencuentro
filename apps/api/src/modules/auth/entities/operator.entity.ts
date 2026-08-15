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

  /**
   * Cuándo se cambió la contraseña por última vez.
   *
   * Sirve para dos cosas: avisar en el panel a quien sigue con la clave que
   * vino en la instalación, y para invalidar sesiones. Un token emitido antes
   * de este momento deja de valer, así que cambiar la contraseña expulsa de
   * verdad a quien la tuviera — que es justo lo que se espera al cambiarla
   * porque se sospecha que alguien más la conoce.
   */
  @Column({ type: 'timestamptz', nullable: true })
  passwordChangedAt: Date | null;

  /**
   * Obliga a cambiar la contraseña antes de poder trabajar.
   *
   * Las cuentas del seed nacen con esto activo: su contraseña está escrita en
   * el repositorio, así que hasta que se cambie no deberían poder ver datos de
   * personas.
   */
  @Column({ type: 'boolean', default: false })
  mustChangePassword: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
