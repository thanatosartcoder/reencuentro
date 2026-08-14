import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoadSegment } from './entities/road-segment.entity';
import { RoadsService } from './roads.service';
import { RoadsController } from './roads.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RoadSegment])],
  controllers: [RoadsController],
  providers: [RoadsService],
  exports: [RoadsService],
})
export class RoadsModule {}
