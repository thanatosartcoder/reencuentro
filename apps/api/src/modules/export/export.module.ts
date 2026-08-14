import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MissingPersonReport } from 'src/modules/persons/entities/missing-person-report.entity';
import { SightingReport } from 'src/modules/persons/entities/sighting-report.entity';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';

@Module({
  imports: [TypeOrmModule.forFeature([MissingPersonReport, SightingReport])],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
