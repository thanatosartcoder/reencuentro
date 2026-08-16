import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  CurrentOperator,
  MaybeOperator,
  OperatorGuard,
  OptionalOperatorGuard,
  Roles,
} from 'src/modules/auth/auth.guard';
import { OperatorClaims } from 'src/modules/auth/auth.service';
import { OperatorRole } from 'src/modules/auth/entities/operator.entity';
import { AuditService } from 'src/modules/audit/audit.service';
import { GeoService } from './geo.service';
import { CreateZoneReportDto, VoteZoneReportDto } from './dto/create-zone-report.dto';
import { NearbyZonesDto, QueryZonesDto } from './dto/query-zones.dto';
import { ZoneReportStatus } from './geo.enums';

class ModerateDto {
  @IsEnum(ZoneReportStatus)
  status: ZoneReportStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

@Controller('mapa')
export class GeoController {
  constructor(
    private readonly geo: GeoService,
    private readonly audit: AuditService,
  ) {}

  /** Catálogo de tipos de reporte con su vida media y su capa. */
  @Get('tipos')
  types() {
    return { items: this.geo.listTypes() };
  }

  /** Reportes de la ventana visible. Es la consulta más caliente del sistema. */
  @Get('reportes')
  query(@Query() query: QueryZonesDto) {
    return this.geo.query(query);
  }

  /** Qué hay alrededor de un punto. Lo que consulta la app al abrirse. */
  @Get('cerca')
  nearby(@Query() query: NearbyZonesDto) {
    return this.geo.nearby(query);
  }

  @Get('resumen')
  summary(@Query('evento') evento?: string) {
    return this.geo.summaryByDepartment(evento);
  }

  @Get('reportes/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.geo.findById(id);
  }

  /**
   * Crea un reporte. Idempotente por `clientUuid`; 200 en lugar de 201.
   *
   * Sigue siendo público: exigir cuenta para avisar de un derrumbe es perder el
   * aviso. El guard opcional no decide quién puede reportar, solo si el rol que
   * la persona declaró se puede respaldar con una cuenta del panel.
   */
  @Post('reportes')
  @HttpCode(200)
  @UseGuards(OptionalOperatorGuard)
  async create(@Body() dto: CreateZoneReportDto, @MaybeOperator() operator?: OperatorClaims) {
    const { report, duplicate } = await this.geo.createReport(dto, operator);
    return { duplicate, report: await this.geo.findById(report.id) };
  }

  /**
   * "Sigue así" / "ya no".
   *
   * Con límite propio y bajo. El general es alto a propósito para no bloquear a
   * quien reporta durante un pico, pero votar no tiene picos legítimos: nadie
   * confirma treinta reportes en un minuto. Lo que sí cabía en ese margen era
   * enterrar una vía cortada a base de refutaciones desde identificadores de
   * dispositivo inventados.
   */
  @Post('reportes/:id/voto')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(OptionalOperatorGuard)
  async vote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoteZoneReportDto,
    @MaybeOperator() operator?: OperatorClaims,
  ) {
    await this.geo.vote(id, dto, operator);
    return this.geo.findById(id);
  }

  /** Retira un reporte falso o duplicado. Solo coordinadores. */
  @Post('reportes/:id/moderar')
  @HttpCode(200)
  @UseGuards(OperatorGuard)
  @Roles(OperatorRole.COORDINATOR)
  async moderate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateDto,
    @CurrentOperator() operator: OperatorClaims,
  ) {
    const report = await this.geo.moderate(id, dto.status, dto.notes);
    await this.audit.record({
      actorId: operator.sub,
      actorName: operator.name,
      action: 'MODERATE_ZONE',
      entityType: 'ZoneReport',
      entityId: id,
      metadata: { status: dto.status, notes: dto.notes },
    });
    return this.geo.findById(report.id);
  }
}
