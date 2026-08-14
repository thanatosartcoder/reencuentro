import { Module } from '@nestjs/common';
import { PersonsModule } from 'src/modules/persons/persons.module';
import { GeoModule } from 'src/modules/geo/geo.module';
import { SituationController } from './situation.controller';

@Module({
  imports: [PersonsModule, GeoModule],
  controllers: [SituationController],
})
export class SituationModule {}
