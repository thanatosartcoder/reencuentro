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
   * Existe para el caso en que una fuente publica una corrección urgente y no
   * se puede esperar al cron de la madrugada.
   *
   * Responde de inmediato y sigue trabajando en segundo plano: la red vial
   * tarda unos dos minutos y medio, y mantener la petición abierta ese tiempo
   * la deja a merced del primer intermediario que corte por inactividad. Quien
   * la lanzó sigue el avance consultando `GET /ingesta/estado`.
   *
   * Lanzar dos veces no duplica trabajo: el advisory lock hace que la segunda
   * termine marcada como omitida.
   */
  @Post('ejecutar')
  @HttpCode(202)
  @UseGuards(OperatorGuard)
  @Roles(OperatorRole.COORDINATOR)
  async run(@Body() dto: RunIngestDto, @CurrentOperator() operator: OperatorClaims) {
    await this.audit.record({
      actorId: operator.sub,
      actorName: operator.name,
      action: 'RUN_INGEST',
      entityType: 'IngestRun',
      metadata: { source: dto.source, force: dto.force ?? false },
    });

    // El fallo se registra dentro del propio servicio, así que aquí basta con
    // no dejar que una promesa rechazada tumbe el proceso.
    void this.ingest
      .run(dto.source, 'manual', { force: dto.force })
      .catch(() => undefined);

    return {
      aceptada: true,
      fuente: dto.source,
      mensaje:
        'La ingesta arrancó en segundo plano. Consulta /api/ingesta/estado para ver el avance.',
    };
  }
}
