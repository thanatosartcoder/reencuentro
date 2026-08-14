import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DamageAssessment } from './entities/damage-assessment.entity';
import { DamageCoverage } from './entities/damage-coverage.entity';
import { DamageService } from './damage.service';
import { DamageController } from './damage.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DamageAssessment, DamageCoverage])],
  controllers: [DamageController],
  providers: [DamageService],
  exports: [DamageService],
})
export class DamageModule {}
