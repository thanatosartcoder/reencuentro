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
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
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
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
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
 */
@Controller('matches')
@UseGuards(OperatorGuard)
export class MatchesController {
  constructor(private readonly matching: MatchingService) {}

  @Get('cola')
  async queue(@Query() query: QueueQueryDto) {
    const { items, total } = await this.matching.listPendingQueue({
      limit: query.limit,
      offset: query.offset,
      onlyHighPriority: query.onlyHighPriority,
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

  @Get('reporte/:missingId')
  async forReport(@Param('missingId', ParseUUIDPipe) missingId: string) {
    const items = await this.matching.listForMissingReport(missingId);
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
