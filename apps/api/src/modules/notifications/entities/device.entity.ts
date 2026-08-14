import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { encryptedText } from 'src/common/crypto/field-crypto';

/**
 * Dispositivo registrado para recibir push.
 *
 * No hay cuentas de usuario: la relacion es dispositivo -> claim tokens de los
 * reportes que ese dispositivo creo. Pedir registro antes de poder reportar a
 * un desaparecido costaria reportes, y el sistema existe para recibirlos.
 */
@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Identificador anonimo generado por el cliente y estable en el tiempo. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  deviceId: string;

  @Column({ type: 'varchar', length: 20 })
  platform: 'web' | 'android' | 'ios';

  @Column({ type: 'text', nullable: true, transformer: encryptedText })
  pushToken: string | null;

  /** Hashes de los claim tokens de los reportes creados desde este dispositivo. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  claimTokenHashes: string[];

  @Column({ type: 'varchar', length: 10, default: 'es' })
  locale: string;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
