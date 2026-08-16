import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { GeoPointDto } from 'src/common/dto/geo-point.dto';
import { ReporterRole } from 'src/modules/persons/persons.enums';
import { VoteKind, ZoneReportType } from '../geo.enums';

/**
 * Valida que un trazado sea una lista de pares [longitud, latitud] reales.
 *
 * El tipo de TypeScript decía `[number, number][]` y no comprobaba nada en
 * ejecución: `path: ["<algo>", {}]` pasaba la validación, entraba en un
 * `LineString` y llegaba hasta la columna `geography`, donde reventaba como un
 * 500 con la traza de la base en lugar de como un 400 que explica qué corregir.
 */
@ValidatorConstraint({ name: 'trazadoValido' })
export class TrazadoValido implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.every(
        (par) =>
          Array.isArray(par) &&
          par.length === 2 &&
          typeof par[0] === 'number' &&
          typeof par[1] === 'number' &&
          Number.isFinite(par[0]) &&
          Number.isFinite(par[1]) &&
          par[0] >= -180 &&
          par[0] <= 180 &&
          par[1] >= -90 &&
          par[1] <= 90,
      )
    );
  }

  defaultMessage(): string {
    return 'path debe ser una lista de pares [longitud, latitud] dentro de rango';
  }
}

export class CreateZoneReportDto {
  @IsUUID('4', { message: 'clientUuid debe ser un UUID v4 generado en el cliente' })
  clientUuid: string;

  @IsEnum(ZoneReportType)
  type: ZoneReportType;

  @ValidateNested()
  @Type(() => GeoPointDto)
  location: GeoPointDto;

  /**
   * Tramo afectado como pares [longitud, latitud]. Un derrumbe que corta 800
   * metros de vía no se representa bien con un punto, y quien planea una ruta
   * necesita saber qué segmento evitar.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(500)
  @Validate(TrazadoValido)
  path?: [number, number][];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(50_000)
  radiusMeters?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  roadName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  municipality?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  severity?: number;

  /**
   * Cuándo se observó. Puede ser bastante anterior al envío: el reporte se creó
   * sin señal y se sincronizó horas después, y la confianza debe decaer desde
   * el momento de la observación, no desde el de la subida.
   */
  @IsOptional()
  @IsDateString()
  reportedAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsEnum(ReporterRole)
  reporterRole?: ReporterRole;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reporterOrganization?: string;

  @IsString()
  @MaxLength(64)
  deviceId: string;
}

export class VoteZoneReportDto {
  @IsUUID('4')
  clientUuid: string;

  @IsEnum(VoteKind)
  vote: VoteKind;

  @IsString()
  @MaxLength(64)
  deviceId: string;

  /**
   * Credencial emitida por `POST /mapa/dispositivos`.
   *
   * Va en el cuerpo y no en una cabecera a proposito: un voto emitido sin señal
   * espera en el outbox y se envia despues dentro de un lote de `/sync/push`,
   * que no lleva cabeceras por operacion. En cabecera, quien vota desde una zona
   * sin cobertura quedaria siempre sin verificar — justo la persona para la que
   * existe el modo sin conexion.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceToken?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  location?: GeoPointDto;

  @IsOptional()
  @IsEnum(ReporterRole)
  voterRole?: ReporterRole;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
