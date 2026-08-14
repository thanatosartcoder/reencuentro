import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { SkipThrottle } from '@nestjs/throttler';
import { CurrentOperator, OperatorGuard, Roles } from 'src/modules/auth/auth.guard';
import { OperatorClaims } from 'src/modules/auth/auth.service';
import { OperatorRole } from 'src/modules/auth/entities/operator.entity';
import { AuditService } from 'src/modules/audit/audit.service';
import { IngestService } from './ingest.service';
import { IngestSource } from './entities/ingest-run.entity';

class RunIngestDto {
  @IsEnum(IngestSource)
  source: IngestSource;

  /** Recarga aunque la fuente no haya cambiado, para corregir una carga mala. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

@Controller('ingesta')
export class IngestController {
  constructor(
    private readonly ingest: IngestService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Cuándo se actualizó cada capa externa. Público: quien mira el mapa tiene
   * derecho a saber si está viendo datos de anoche o de hace una semana.
   */
  @Get('estado')
  @SkipThrottle()
  status() {
    return this.ingest.status();
  }

  /**
   * Dispara una ingesta a mano.
   *
   * Existe para el caso en que HDX publica una corrección urgente y no se puede
   * esperar al cron de la madrugada. Descarga cientos de megabytes, así que
   * queda restringida a coordinadores y registrada en bitácora.
   */
  @Post('ejecutar')
  @HttpCode(200)
  @UseGuards(OperatorGuard)
  @Roles(OperatorRole.COORDINATOR)
  async run(@Body() dto: RunIngestDto, @CurrentOperator() operator: OperatorClaims) {
    const run = await this.ingest.run(dto.source, 'manual', { force: dto.force });

    await this.audit.record({
      actorId: operator.sub,
      actorName: operator.name,
      action: 'RUN_INGEST',
      entityType: 'IngestRun',
      entityId: run.id,
      metadata: { source: dto.source, force: dto.force ?? false, status: run.status },
    });

    return {
      id: run.id,
      fuente: run.source,
      estado: run.status,
      registros: run.recordsLoaded,
      duracionSegundos: run.durationSeconds,
      error: run.error,
    };
  }
}
