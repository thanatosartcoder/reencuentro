import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZoneReport } from './entities/zone-report.entity';
import { ZoneReportVote } from './entities/zone-report-vote.entity';
import { GeoService } from './geo.service';
import { GeoController } from './geo.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ZoneReport, ZoneReportVote])],
  controllers: [GeoController],
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
