import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
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

class ListSightingsDto {
  /**
   * Cuántos avistamientos recientes devolver.
   *
   * Era la única ruta de listado sin DTO: leía `Number(limit) || 25` directo de
   * la query, así que `?limit=1000000` cargaba en memoria un millón de filas con
   * sus fotos unidas. Cien es el tope del resto del sistema.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

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

  /**
   * Un caso concreto, sin sesión.
   *
   * Usa la consulta pública, que respeta el consentimiento y el borrado lógico.
   * La consulta general los aplicaba y esta no, así que un enlace directo
   * publicaba lo que el listado había ocultado.
   */
  @Get('desaparecidos/:id')
  async findMissing(@Param('id', ParseUUIDPipe) id: string) {
    return toPublicMissing(await this.persons.findPublicMissingById(id));
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

  /**
   * Seguimiento del caso por parte de quien lo reportó.
   *
   * El token viaja en una cabecera y ya no en la URL. Es una credencial que da
   * acceso a documento, teléfono, correo y notas médicas, y una URL no es un
   * sitio donde guardar eso: queda en el registro de accesos del servidor y de
   * cada intermediario, en el historial del navegador y en cualquier captura de
   * pantalla que alguien mande pidiendo ayuda con la aplicación.
   */
  @Get('mis-reportes')
  async findByClaim(@Headers('x-claim-token') claimToken?: string) {
    if (!claimToken) {
      throw new UnauthorizedException('Falta la cabecera X-Claim-Token');
    }
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
  async listSightings(@Query() query: ListSightingsDto) {
    const items = await this.persons.listRecentSightings(query.limit ?? 25);
    return { items: items.map(toPublicSighting) };
  }

  /**
   * Vista completa de un avistamiento. Cada consulta queda en bitácora.
   *
   * Devuelve documento, teléfono del reportante y estado de salud — los mismos
   * datos que su equivalente para desapariciones, que sí se registraba. Que la
   * trazabilidad dependiera de por cuál de las dos puertas se entró era un hueco
   * en lo que la Ley 1581 obliga a poder demostrar.
   */
  @Get('avistamientos/:id')
  @UseGuards(OperatorGuard)
  async findSighting(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOperator() operator: OperatorClaims,
    @Req() request: Request,
  ) {
    const sighting = await this.persons.findSightingById(id);
    await this.audit.record({
      actorId: operator.sub,
      actorName: operator.name,
      action: 'VIEW_PII',
      entityType: 'SightingReport',
      entityId: id,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
    return toOperatorSighting(sighting);
  }

  // --------------------------------------------------------------------------

  @Get('estadisticas')
  stats() {
    return this.persons.getStats();
  }
}
