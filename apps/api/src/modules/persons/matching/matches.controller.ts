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
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuditService } from 'src/modules/audit/audit.service';
import { CurrentOperator, OperatorGuard, Roles } from 'src/modules/auth/auth.guard';
import { OperatorClaims } from 'src/modules/auth/auth.service';
import { OperatorRole } from 'src/modules/auth/entities/operator.entity';
import { fromGeoPoint } from 'src/common/geo/geo.util';
import { toPhotoView } from '../persons.presenter';
import { MatchingService } from './matching.service';
import { MatchCandidate } from '../entities/match-candidate.entity';

class ReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

class QueueQueryDto {
  /**
   * Tamaño de página, con tope.
   *
   * El tope no es cosmético: cada elemento de esta cola trae el documento, las
   * notas médicas y la coordenada exacta de las dos personas que se comparan.
   * Sin `@Max`, una sola petición con `limit=999999` se lleva toda la base de
   * datos de personas, y una cuenta comprometida no necesita más que eso.
   * Cincuenta es más de lo que cabe en una pantalla de revisión.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onlyHighPriority?: boolean;
}

/**
 * Cola de revisión humana.
 *
 * Todo el módulo exige autenticación de operador: aquí se ven simultáneamente
 * los datos completos del desaparecido y los de quien fue encontrado, que es la
 * combinación más sensible del sistema.
 *
 * El rol se exige a nivel de clase y no endpoint por endpoint. Autenticar sin
 * exigir rol dejaba entrar también a VIEWER —cuya descripción es "consultar el
 * panel"— a la misma vista de datos personales que ve un validador, de modo que
 * repartir cuentas de solo lectura repartía en realidad acceso completo. Lo que
 * distingue a esta cola no es escribir: es mirar.
 */
@Controller('matches')
@UseGuards(OperatorGuard)
@Roles(OperatorRole.VALIDATOR, OperatorRole.COORDINATOR)
export class MatchesController {
  constructor(
    private readonly matching: MatchingService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Cola pendiente. Cada consulta queda en bitácora.
   *
   * Consultar la cola es un acceso masivo a datos personales —decenas de
   * documentos y notas médicas por página— y hasta ahora era el único camino
   * hacia esos datos que no dejaba rastro, mientras que abrir un solo reporte sí
   * lo dejaba. La Ley 1581 obliga a poder responder quién los consultó, y la
   * respuesta no puede depender de por qué puerta entró.
   */
  @Get('cola')
  async queue(
    @Query() query: QueueQueryDto,
    @CurrentOperator() operator: OperatorClaims,
    @Req() request: Request,
  ) {
    const { items, total } = await this.matching.listPendingQueue({
      limit: query.limit,
      offset: query.offset,
      onlyHighPriority: query.onlyHighPriority,
    });

    await this.audit.record({
      actorId: operator.sub,
      actorName: operator.name,
      action: 'VIEW_PII',
      entityType: 'MatchQueue',
      // Se registra cuántos registros salieron, no cuáles: la bitácora tiene que
      // poder mostrar el volumen de una consulta sin convertirse ella misma en
      // una segunda copia de los identificadores.
      metadata: {
        devueltos: items.length,
        offset: query.offset ?? 0,
        soloAltaPrioridad: query.onlyHighPriority ?? false,
      },
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });

    return { total, items: items.map(toReviewView) };
  }

  /**
   * Confirma la coincidencia. Es el único punto del sistema desde el que sale
   * un aviso a la familia, y por eso requiere rol de validador.
   */
  @Post(':id/confirmar')
  @HttpCode(200)
  @Roles(OperatorRole.VALIDATOR, OperatorRole.COORDINATOR)
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
    @CurrentOperator() operator: OperatorClaims,
  ) {
    const candidate = await this.matching.confirm(
      id,
      { id: operator.sub, name: operator.name },
      dto.notes,
    );
    return { id: candidate.id, status: candidate.status, notifiedAt: candidate.notifiedAt };
  }

  @Post(':id/rechazar')
  @HttpCode(200)
  @Roles(OperatorRole.VALIDATOR, OperatorRole.COORDINATOR)
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
    @CurrentOperator() operator: OperatorClaims,
  ) {
    const candidate = await this.matching.reject(
      id,
      { id: operator.sub, name: operator.name },
      dto.notes,
    );
    return { id: candidate.id, status: candidate.status };
  }

  /** Candidatos de un reporte concreto. Devuelve PII, así que también se audita. */
  @Get('reporte/:missingId')
  async forReport(
    @Param('missingId', ParseUUIDPipe) missingId: string,
    @CurrentOperator() operator: OperatorClaims,
    @Req() request: Request,
  ) {
    const items = await this.matching.listForMissingReport(missingId);

    await this.audit.record({
      actorId: operator.sub,
      actorName: operator.name,
      action: 'VIEW_PII',
      entityType: 'MissingPersonReport',
      entityId: missingId,
      metadata: { via: 'candidatos', devueltos: items.length },
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });

    return { items: items.map(toReviewView) };
  }
}

/**
 * Vista de un candidato para el revisor: los dos registros lado a lado y el
 * desglose del score. El validador tiene que poder ver en qué se apoya la
 * propuesta y en qué no, no solo un número.
 */
function toReviewView(candidate: MatchCandidate) {
  const missing = candidate.missingReport;
  const sighting = candidate.sightingReport;

  return {
    id: candidate.id,
    score: candidate.score,
    tier: candidate.tier,
    status: candidate.status,
    highPriority: candidate.highPriority,
    breakdown: candidate.breakdown,
    createdAt: candidate.createdAt,
    reviewedAt: candidate.reviewedAt,
    reviewedByName: candidate.reviewedByName,
    missing: missing && {
      id: missing.id,
      fullName: missing.fullName,
      aliases: missing.aliases,
      age: missing.age,
      ageMin: missing.ageMin,
      ageMax: missing.ageMax,
      sex: missing.sex,
      heightCm: missing.heightCm,
      build: missing.build,
      skinTone: missing.skinTone,
      hairColor: missing.hairColor,
      clothingDescription: missing.clothingDescription,
      distinguishingMarks: missing.distinguishingMarks,
      isMinor: missing.isMinor,
      documentType: missing.documentType,
      documentNumber: missing.documentNumber,
      lastSeenAt: missing.lastSeenAt,
      lastSeenLocation: fromGeoPoint(missing.lastSeenLocation),
      lastSeenAddress: missing.lastSeenAddress,
      department: missing.department,
      municipality: missing.municipality,
      circumstances: missing.circumstances,
      medicalNotes: missing.medicalNotes,
      reporterName: missing.reporterName,
      reporterRelationship: missing.reporterRelationship,
      photos: (missing.photos ?? []).map(toPhotoView),
    },
    sighting: sighting && {
      id: sighting.id,
      kind: sighting.kind,
      fullName: sighting.fullName,
      estimatedAgeMin: sighting.estimatedAgeMin,
      estimatedAgeMax: sighting.estimatedAgeMax,
      sex: sighting.sex,
      heightCm: sighting.heightCm,
      build: sighting.build,
      skinTone: sighting.skinTone,
      hairColor: sighting.hairColor,
      clothingDescription: sighting.clothingDescription,
      distinguishingMarks: sighting.distinguishingMarks,
      condition: sighting.condition,
      isMinor: sighting.isMinor,
      documentType: sighting.documentType,
      documentNumber: sighting.documentNumber,
      seenAt: sighting.seenAt,
      location: fromGeoPoint(sighting.location),
      address: sighting.address,
      department: sighting.department,
      municipality: sighting.municipality,
      facilityName: sighting.facilityName,
      notes: sighting.notes,
      reporterName: sighting.reporterName,
      reporterRole: sighting.reporterRole,
      reporterOrganization: sighting.reporterOrganization,
      photos: (sighting.photos ?? []).map(toPhotoView),
    },
  };
}
