import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { GeoPointDto } from 'src/common/dto/geo-point.dto';
import { DocumentType, ReportSource, ReporterRole, Sex } from '../persons.enums';

/**
 * Alta de un reporte de desaparicion.
 *
 * Solo tres campos son obligatorios: el UUID que genera el cliente, el nombre y
 * como contactar a quien reporta. Todo lo demas es opcional a proposito. Quien
 * llama desde una zona sin senal, en shock y sin documentos a la mano, no puede
 * llenar un formulario largo, y un reporte incompleto vale infinitamente mas
 * que un reporte que nunca se envio.
 */
export class CreateMissingReportDto {
  /**
   * UUID generado en el dispositivo antes de tener red. Es la clave de
   * idempotencia: reenviar el mismo reporte no crea duplicados.
   */
  @IsUUID('4', { message: 'clientUuid debe ser un UUID v4 generado en el cliente' })
  clientUuid: string;

  // --- Identidad ---

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  aliases?: string[];

  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  documentNumber?: string;

  // --- Descripcion fisica ---

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  age?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  ageMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  ageMax?: number;

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
  @IsString()
  @MaxLength(2000)
  medicalNotes?: string;

  // --- Ultima ubicacion conocida ---

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  lastSeenLocation?: GeoPointDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  lastSeenAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  municipality?: string;

  @IsOptional()
  @IsDateString({}, { message: 'lastSeenAt debe ser una fecha ISO 8601' })
  lastSeenAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  circumstances?: string;

  // --- Quien reporta ---

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reporterName: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  reporterPhone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'reporterEmail debe ser un correo válido' })
  @MaxLength(200)
  reporterEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reporterRelationship?: string;

  @IsOptional()
  @IsEnum(ReporterRole)
  reporterRole?: ReporterRole;

  @IsOptional()
  @IsEnum(ReportSource)
  source?: ReportSource;

  /**
   * Publicar nombre y foto en el listado abierto. Si se niega, el caso sigue
   * entrando al motor de matching pero no aparece en la busqueda publica.
   */
  @IsOptional()
  @IsBoolean()
  consentPublicListing?: boolean;

  /** Identificador anonimo del dispositivo, para asociar el caso y el push. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceId?: string;
}
