import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeismicEvent } from './entities/seismic-event.entity';
import { SeismicService } from './seismic.service';
import { SeismicController } from './seismic.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SeismicEvent])],
  controllers: [SeismicController],
  providers: [SeismicService],
  exports: [SeismicService],
})
export class SeismicModule {}
