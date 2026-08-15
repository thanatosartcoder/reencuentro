import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEntity } from './entities/event.entity';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

/**
 * Global: casi toda capa de contexto necesita saber a qué emergencia pertenece
 * lo que escribe, y reimportarlo en cada módulo no aporta nada.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([EventEntity])],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
