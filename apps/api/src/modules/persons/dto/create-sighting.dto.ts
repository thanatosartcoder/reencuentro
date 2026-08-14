import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { GeoPointDto } from 'src/common/dto/geo-point.dto';
import {
  DocumentType,
  PersonCondition,
  ReportSource,
  ReporterRole,
  Sex,
  SightingKind,
} from '../persons.enums';

/**
 * "Vi a esta persona" o "esta persona está aquí".
 *
 * Solo se exigen la hora del avistamiento y el UUID del cliente. Ni siquiera el
 * nombre: en campo se encuentra gente inconsciente o menores que no saben su
 * apellido, y esos son precisamente los casos donde el sistema mas hace falta.
 */
export class CreateSightingDto {
  @IsUUID('4', { message: 'clientUuid debe ser un UUID v4 generado en el cliente' })
  clientUuid: string;

  @IsOptional()
  @IsEnum(SightingKind)
  kind?: SightingKind;

  // --- Identidad, si se conoce ---

  @IsOptional()
  @IsString()
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  documentNumber?: string;

  // --- Descripcion observada ---

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  estimatedAgeMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  estimatedAgeMax?: number;

  @IsOptional()
  @IsEnum(Sex)
  sex?: Sex;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(250)
  heightCm?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  build?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  skinTone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  hairColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  clothingDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  distinguishingMarks?: string;

  @IsOptional()
  @IsEnum(PersonCondition)
  condition?: PersonCondition;

  // --- Donde y cuando ---

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  location?: GeoPointDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  municipality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  facilityName?: string;

  @IsDateString({}, { message: 'seenAt debe ser una fecha ISO 8601' })
  seenAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  // --- Quien reporta ---

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reporterName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  reporterPhone?: string;

  @IsOptional()
  @IsEnum(ReporterRole)
  reporterRole?: ReporterRole;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reporterOrganization?: string;

  @IsOptional()
  @IsEnum(ReportSource)
  source?: ReportSource;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceId?: string;
}
