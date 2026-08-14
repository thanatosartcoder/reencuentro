import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditService } from 'src/modules/audit/audit.service';
import { CurrentOperator, OperatorGuard } from 'src/modules/auth/auth.guard';
import { OperatorClaims } from 'src/modules/auth/auth.service';
import { PersonsService } from './persons.service';
import { CreateMissingReportDto } from './dto/create-missing-report.dto';
import { CreateSightingDto } from './dto/create-sighting.dto';
import { QueryMissingDto } from './dto/query-missing.dto';
import { MissingStatus } from './persons.enums';
import {
  toOperatorMissing,
  toOperatorSighting,
  toOwnerMissing,
  toPublicMissing,
  toPublicSighting,
} from './persons.presenter';

class CloseReportDto {
  @IsString()
  claimToken: string;

  @IsEnum([MissingStatus.FOUND_ALIVE, MissingStatus.CANCELLED] as const)
  outcome: MissingStatus.FOUND_ALIVE | MissingStatus.CANCELLED;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

@Controller('personas')
export class PersonsController {
  constructor(
    private readonly persons: PersonsService,
    private readonly audit: AuditService,
  ) {}

  // --------------------------------------------------------------------------
  // Reportes de desaparición
  // --------------------------------------------------------------------------

  /**
   * Crea un reporte de desaparición.
   *
   * Devuelve 200, no 201, porque la operación es idempotente: reenviar el mismo
   * `clientUuid` no crea nada y responde con el reporte existente. El campo
   * `duplicate` le dice al cliente offline si su reintento surtió efecto.
   */
  @Post('desaparecidos')
  @HttpCode(200)
  async createMissing(@Body() dto: CreateMissingReportDto) {
    const result = await this.persons.createMissingReport(dto);
    return {
      duplicate: result.duplicate,
      // El claim token viaja una sola vez, en la respuesta de la creación
      // original. No se puede volver a consultar: en la base solo queda su hash.
      claimToken: result.claimToken,
      // En la creación original se devuelve la vista del dueño, que incluye sus
      // datos de contacto. En un reintento se devuelve solo la vista pública:
      // quien reenvía un clientUuid ya tiene su claim token guardado, y así
      // conocer un clientUuid ajeno nunca alcanza para leer datos personales.
      report: result.duplicate ? toPublicMissing(result.report) : toOwnerMissing(result.report),
    };
  }

  /** Listado y búsqueda pública de desaparecidos. */
  @Get('desaparecidos')
  async searchMissing(@Query() query: QueryMissingDto) {
    const page = await this.persons.searchMissing(query);
    return { ...page, items: page.items.map(toPublicMissing) };
  }

  @Get('desaparecidos/:id')
  async findMissing(@Param('id', ParseUUIDPipe) id: string) {
    return toPublicMissing(await this.persons.findMissingById(id));
  }

  /** Vista completa para el panel de validación. Cada consulta queda en bitácora. */
  @Get('desaparecidos/:id/completo')
  @UseGuards(OperatorGuard)
  async findMissingFull(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOperator() operator: OperatorClaims,
    @Req() request: Request,
  ) {
    const report = await this.persons.findMissingById(id);
    await this.audit.record({
      actorId: operator.sub,
      actorName: operator.name,
      action: 'VIEW_PII',
      entityType: 'MissingPersonReport',
      entityId: id,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
    return toOperatorMissing(report);
  }

  /** Seguimiento del caso por parte de quien lo reportó. */
  @Get('mis-reportes')
  async findByClaim(@Query('claimToken') claimToken: string) {
    const report = await this.persons.findByClaimToken(claimToken);
    return toOwnerMissing(report);
  }

  @Post('desaparecidos/cerrar')
  @HttpCode(200)
  async close(@Body() dto: CloseReportDto) {
    const report = await this.persons.closeByOwner(dto.claimToken, dto.outcome, dto.notes);
    return toOwnerMissing(report);
  }

  // --------------------------------------------------------------------------
  // Avistamientos
  // --------------------------------------------------------------------------

  @Post('avistamientos')
  @HttpCode(200)
  async createSighting(@Body() dto: CreateSightingDto) {
    const result = await this.persons.createSighting(dto);
    return {
      duplicate: result.duplicate,
      claimToken: result.claimToken,
      report: toPublicSighting(result.report),
    };
  }

  @Get('avistamientos')
  async listSightings(@Query('limit') limit?: string) {
    const items = await this.persons.listRecentSightings(Number(limit) || 25);
    return { items: items.map(toPublicSighting) };
  }

  @Get('avistamientos/:id')
  @UseGuards(OperatorGuard)
  async findSighting(@Param('id', ParseUUIDPipe) id: string) {
    return toOperatorSighting(await this.persons.findSightingById(id));
  }

  // --------------------------------------------------------------------------

  @Get('estadisticas')
  stats() {
    return this.persons.getStats();
  }
}
