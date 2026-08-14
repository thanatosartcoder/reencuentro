import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationOutbox } from './entities/notification-outbox.entity';
import { Device } from './entities/device.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { RealtimeGateway } from './realtime.gateway';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([NotificationOutbox, Device])],
  controllers: [NotificationsController],
  providers: [NotificationsService, RealtimeGateway],
  exports: [NotificationsService, RealtimeGateway],
})
export class NotificationsModule {}
