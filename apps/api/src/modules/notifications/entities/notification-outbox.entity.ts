import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { encryptedText } from 'src/common/crypto/field-crypto';
import {
  NotificationChannel,
  NotificationKind,
  NotificationStatus,
} from '../notifications.enums';

/**
 * Outbox de notificaciones salientes.
 *
 * La confirmacion de un match y el envio de la notificacion ocurren en la misma
 * transaccion que escribe aqui la fila; el despachador la toma despues. Asi el
 * aviso no se pierde si el proceso se cae justo entre confirmar y enviar, que
 * es exactamente el mensaje que no puede perderse.
 */
@Entity('notification_outbox')
@Index(['status', 'nextAttemptAt'])
export class NotificationOutbox {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: NotificationKind })
  kind: NotificationKind;

  @Column({ type: 'enum', enum: NotificationChannel })
  channel: NotificationChannel;

  /**
   * Sala de WebSocket o identificador logico del destinatario. Para el
   * reportante anonimo es el hash de su claim token, no un user id.
   */
  @Index()
  @Column({ type: 'varchar', length: 128 })
  recipientKey: string;

  /** Telefono, token FCM o correo. Cifrado: es un dato de contacto personal. */
  @Column({ type: 'text', nullable: true, transformer: encryptedText })
  recipientAddress: string | null;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, unknown>;

  @Index()
  @Column({ type: 'enum', enum: NotificationStatus, default: NotificationStatus.PENDING })
  status: NotificationStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** Backoff exponencial: la red en zona de desastre falla de forma intermitente. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  /** Match, reporte o zona que origino la notificacion. */
  @Column({ type: 'uuid', nullable: true })
  relatedEntityId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
