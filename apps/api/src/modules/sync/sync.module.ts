import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PersonsModule } from 'src/modules/persons/persons.module';
import { GeoModule } from 'src/modules/geo/geo.module';
import { ZoneReport } from 'src/modules/geo/entities/zone-report.entity';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';

@Module({
  imports: [PersonsModule, GeoModule, TypeOrmModule.forFeature([ZoneReport])],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
