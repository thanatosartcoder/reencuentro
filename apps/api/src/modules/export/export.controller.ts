import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentOperator, OperatorGuard, Roles } from 'src/modules/auth/auth.guard';
import { OperatorClaims } from 'src/modules/auth/auth.service';
import { OperatorRole } from 'src/modules/auth/entities/operator.entity';
import { AuditService } from 'src/modules/audit/audit.service';
import { MissingStatus } from 'src/modules/persons/persons.enums';
import { ExportService } from './export.service';
import { PFIF_NAMESPACE, type PfifScope } from './pfif.builder';

class PfifQueryDto {
  @IsOptional()
  @IsEnum(['public', 'full'] as const, { message: 'scope debe ser public o full' })
  scope?: PfifScope;

  @IsOptional()
  @IsDateString()
  since?: string;

  @IsOptional()
  @IsEnum(MissingStatus)
  status?: MissingStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;
}

/**
 * Exportación en PFIF 1.4.
 *
 * Es el puente hacia el registro oficial. Hoy no hay una API colombiana en vivo
 * contra la cual sincronizar —el catálogo de emergencias de la UNGRD en
 * datos.gov.co llega hasta 2022 y el de desaparecidos se publica por lotes
 * mensuales—, así que la entrega será un archivo acordado. Que ese archivo esté
 * en un estándar internacional y no en un CSV inventado es lo que hace la
 * diferencia entre integrarse y volver a negociar el formato cada vez.
 */
@Controller('export')
@UseGuards(OperatorGuard)
export class ExportController {
  constructor(
    private readonly exportService: ExportService,
    private readonly audit: AuditService,
  ) {}

  @Get('pfif')
  @Roles(OperatorRole.COORDINATOR)
  async pfif(
    @Query() query: PfifQueryDto,
    @CurrentOperator() operator: OperatorClaims,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    // `full` incluye teléfono, correo y documento. Se reserva a ADMIN porque
    // solo tiene sentido bajo un acuerdo de tratamiento de datos con la entidad
    // receptora, no como descarga de rutina.
    const scope: PfifScope =
      query.scope === 'full' && operator.role === OperatorRole.ADMIN ? 'full' : 'public';

    const baseUrl = `${request.protocol}://${request.get('host')}`;

    const { xml, counts } = await this.exportService.buildPfif({
      scope,
      since: query.since ? new Date(query.since) : undefined,
      status: query.status,
      department: query.department,
      limit: query.limit ?? 1000,
      baseUrl,
    });

    // Una exportación es una salida masiva de datos personales: queda en la
    // bitácora con quién la pidió, con qué alcance y cuántos registros se
    // llevó. Es exactamente lo que la Ley 1581 exige poder demostrar.
    await this.audit.record({
      actorId: operator.sub,
      actorName: operator.name,
      action: 'EXPORT_PFIF',
      entityType: 'Export',
      metadata: { scope, counts, filters: { ...query, scope } },
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    response.setHeader('Content-Type', 'application/xml; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="reencuentro-pfif-${scope}-${stamp}.xml"`,
    );
    response.setHeader('X-PFIF-Version', '1.4');
    response.setHeader('X-PFIF-Namespace', PFIF_NAMESPACE);
    response.setHeader('X-PFIF-Records', String(counts.missing + counts.sightings));
    response.send(xml);
  }

  /** Cuántos registros saldrían, sin generar el documento ni exponer datos. */
  @Get('pfif/resumen')
  @Roles(OperatorRole.VALIDATOR, OperatorRole.COORDINATOR)
  async summary(@Query() query: PfifQueryDto) {
    const { counts } = await this.exportService.buildPfif({
      scope: 'public',
      since: query.since ? new Date(query.since) : undefined,
      status: query.status,
      department: query.department,
      limit: query.limit ?? 5000,
      baseUrl: '',
    });

    return {
      formato: 'PFIF 1.4',
      namespace: PFIF_NAMESPACE,
      especificacion: 'http://zesty.ca/pfif/1.4/',
      registros: {
        desaparecidos: counts.missing,
        avistamientos: counts.sightings,
        total: counts.missing + counts.sightings,
      },
      nota:
        'El alcance "full" incluye datos de contacto y documento, requiere rol ' +
        'ADMIN y solo debe entregarse bajo acuerdo de tratamiento de datos.',
    };
  }
}
