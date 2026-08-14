import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EntityManager, LessThanOrEqual, Repository } from 'typeorm';
import { NotificationOutbox } from './entities/notification-outbox.entity';
import { Device } from './entities/device.entity';
import {
  NotificationChannel,
  NotificationKind,
  NotificationStatus,
} from './notifications.enums';
import { RealtimeGateway, claimRoom } from './realtime.gateway';

export interface EnqueueNotificationInput {
  kind: NotificationKind;
  recipientKey: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  relatedEntityId?: string;
  channels?: NotificationChannel[];
}

const MAX_ATTEMPTS = 8;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(NotificationOutbox)
    private readonly outboxRepo: Repository<NotificationOutbox>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    private readonly gateway: RealtimeGateway,
  ) {}

  /**
   * Encola una notificacion.
   *
   * Recibe opcionalmente el EntityManager de una transaccion en curso para que
   * la fila del outbox se escriba en el mismo commit que el cambio que la
   * origina. Si el proceso muere entre confirmar un match y avisar a la
   * familia, al reiniciar la notificacion sigue pendiente en lugar de haberse
   * perdido: es justo el mensaje que no puede perderse.
   */
  async enqueue(
    input: EnqueueNotificationInput,
    manager?: EntityManager,
  ): Promise<NotificationOutbox[]> {
    const repo = manager ? manager.getRepository(NotificationOutbox) : this.outboxRepo;
    const channels = input.channels ?? [NotificationChannel.WEBSOCKET, NotificationChannel.PUSH];

    const rows = channels.map((channel) =>
      repo.create({
        kind: input.kind,
        channel,
        recipientKey: input.recipientKey,
        title: input.title,
        body: input.body,
        payload: input.payload ?? {},
        relatedEntityId: input.relatedEntityId ?? null,
        status: NotificationStatus.PENDING,
        nextAttemptAt: new Date(),
      }),
    );

    return repo.save(rows);
  }

  /**
   * Despachador del outbox.
   *
   * Corre cada 15 segundos porque en una emergencia el retraso importa, y toma
   * las filas con FOR UPDATE SKIP LOCKED para que varias instancias de la API
   * puedan despachar en paralelo sin enviar dos veces la misma notificacion.
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async dispatchPending(): Promise<void> {
    const batch = await this.outboxRepo.manager.transaction(async (manager) => {
      const rows: NotificationOutbox[] = await manager
        .createQueryBuilder(NotificationOutbox, 'n')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('n.status = :status', { status: NotificationStatus.PENDING })
        .andWhere('n."nextAttemptAt" <= now()')
        .orderBy('n."nextAttemptAt"', 'ASC')
        .limit(50)
        .getMany();

      if (rows.length) {
        await manager.update(
          NotificationOutbox,
          rows.map((r) => r.id),
          // Se aparta la fila del siguiente barrido mientras se intenta el
          // envio; si el envio falla, el catch la reprograma con backoff.
          { nextAttemptAt: new Date(Date.now() + 60_000) },
        );
      }
      return rows;
    });

    for (const notification of batch) {
      await this.deliver(notification);
    }
  }

  private async deliver(notification: NotificationOutbox): Promise<void> {
    try {
      switch (notification.channel) {
        case NotificationChannel.WEBSOCKET:
          this.gateway.emitToRoom(claimRoom(notification.recipientKey), 'notification', {
            id: notification.id,
            kind: notification.kind,
            title: notification.title,
            body: notification.body,
            payload: notification.payload,
            createdAt: notification.createdAt,
          });
          break;

        case NotificationChannel.PUSH:
          await this.deliverPush(notification);
          break;

        default:
          // SMS y correo quedan pendientes de proveedor. Marcarlas como
          // fallidas en vez de reintentar para siempre evita que la cola se
          // llene de filas que nadie puede entregar.
          throw new Error(`Canal ${notification.channel} sin proveedor configurado`);
      }

      await this.outboxRepo.update(notification.id, {
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        attempts: notification.attempts + 1,
        lastError: null,
      });
    } catch (error) {
      const attempts = notification.attempts + 1;
      const message = error instanceof Error ? error.message : String(error);

      if (attempts >= MAX_ATTEMPTS) {
        await this.outboxRepo.update(notification.id, {
          status: NotificationStatus.FAILED,
          attempts,
          lastError: message,
        });
        this.logger.error(
          `Notificación ${notification.id} agotó los reintentos: ${message}`,
        );
        return;
      }

      // Backoff exponencial con techo de 30 minutos: en zona de desastre la red
      // se cae por rachas, y reintentar en bucle cerrado solo consume batería.
      const delayMs = Math.min(30 * 60_000, 2 ** attempts * 5_000);
      await this.outboxRepo.update(notification.id, {
        attempts,
        nextAttemptAt: new Date(Date.now() + delayMs),
        lastError: message,
      });
    }
  }

  /**
   * Envio push. Requiere FCM_SERVER_KEY configurada; sin proveedor la
   * notificacion se marca como fallida en lugar de fingir que salio.
   */
  private async deliverPush(notification: NotificationOutbox): Promise<void> {
    const serverKey = process.env.FCM_SERVER_KEY;
    if (!serverKey) {
      throw new Error('FCM_SERVER_KEY no configurada');
    }

    const devices = await this.deviceRepo
      .createQueryBuilder('d')
      .where(':hash = ANY(d."claimTokenHashes")', { hash: notification.recipientKey })
      .andWhere('d."pushToken" IS NOT NULL')
      .getMany();

    if (!devices.length) {
      throw new Error('Sin dispositivos registrados para este destinatario');
    }

    const tokens = devices.map((d) => d.pushToken).filter((t): t is string => Boolean(t));

    const response = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        Authorization: `key=${serverKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        registration_ids: tokens,
        notification: { title: notification.title, body: notification.body },
        data: { kind: notification.kind, ...notification.payload },
        priority: 'high',
      }),
    });

    if (!response.ok) {
      throw new Error(`FCM respondió ${response.status}: ${await response.text()}`);
    }
  }

  /** Registra o actualiza un dispositivo y lo asocia a un claim token. */
  async registerDevice(input: {
    deviceId: string;
    platform: 'web' | 'android' | 'ios';
    pushToken?: string;
    claimTokenHash?: string;
    locale?: string;
  }): Promise<Device> {
    let device = await this.deviceRepo.findOne({ where: { deviceId: input.deviceId } });

    if (!device) {
      device = this.deviceRepo.create({
        deviceId: input.deviceId,
        platform: input.platform,
        claimTokenHashes: [],
      });
    }

    device.platform = input.platform;
    if (input.pushToken) device.pushToken = input.pushToken;
    if (input.locale) device.locale = input.locale;
    if (input.claimTokenHash && !device.claimTokenHashes.includes(input.claimTokenHash)) {
      device.claimTokenHashes = [...device.claimTokenHashes, input.claimTokenHash];
    }
    device.lastSeenAt = new Date();

    return this.deviceRepo.save(device);
  }

  /** Historial de notificaciones de un reportante, para la vista "mis reportes". */
  async listForRecipient(recipientKey: string, limit = 50): Promise<NotificationOutbox[]> {
    return this.outboxRepo.find({
      where: { recipientKey, channel: NotificationChannel.WEBSOCKET },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /** Cancela avisos que dejaron de tener sentido porque el caso se cerró por otra vía. */
  async cancelPendingFor(relatedEntityId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(NotificationOutbox) : this.outboxRepo;
    await repo.update(
      { relatedEntityId, status: NotificationStatus.PENDING },
      { status: NotificationStatus.CANCELLED },
    );
  }

  /** Purga notificaciones entregadas hace mucho; el outbox no es un archivo histórico. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeOld(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 24 * 3_600_000);
    const result = await this.outboxRepo.delete({
      status: NotificationStatus.SENT,
      sentAt: LessThanOrEqual(cutoff),
    });
    if (result.affected) {
      this.logger.log(`Purgadas ${result.affected} notificaciones entregadas`);
    }
  }
}
