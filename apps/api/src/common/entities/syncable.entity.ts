import {
  CreateDateColumn,
  DeleteDateColumn,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Column,
} from 'typeorm';

/**
 * Base de toda entidad que un cliente offline puede crear o recibir.
 *
 * `clientUuid` es la clave de idempotencia: el dispositivo genera el UUID antes
 * de tener red, muestra el reporte como "guardado" al instante y reintenta el
 * envio cuantas veces haga falta. El backend deduplica por este campo, no por
 * el contenido.
 *
 * `revision` la asigna un trigger desde una secuencia global compartida por
 * todas las tablas sincronizables. Avanza tanto en INSERT como en UPDATE, asi
 * que un cliente puede pedir "todo lo que cambio despues de la revision N" y
 * recibir tambien las ediciones, no solo las altas. Un cursor basado en
 * updatedAt no daria ese orden total.
 */
export abstract class SyncableEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  clientUuid: string;

  @Index()
  @Column({ type: 'bigint', insert: false, update: false, default: 0 })
  revision: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
