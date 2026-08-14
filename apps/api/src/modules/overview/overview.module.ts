import { Module } from '@nestjs/common';
import { OverviewService } from './overview.service';
import { OverviewController } from './overview.controller';

/**
 * Cruza datos de varios módulos (personas, zonas, daño, sismos) para responder
 * preguntas territoriales. Usa el DataSource directamente en lugar de los
 * repositorios de cada módulo: son consultas de agregación que no encajan en
 * ninguno de ellos y hacerlas depender de todos crearía un nudo de imports.
 */
@Module({
  controllers: [OverviewController],
  providers: [OverviewService],
  exports: [OverviewService],
})
export class OverviewModule {}
