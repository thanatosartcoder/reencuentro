import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ZoneReportType } from '../geo.enums';

export class QueryZonesDto {
  /** Ventana visible del mapa: "minLon,minLat,maxLon,maxLat". */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bbox?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(ZoneReportType, { each: true })
  @Type(() => String)
  types?: ZoneReportType[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  /**
   * Umbral de confianza. Por defecto se ocultan los reportes ya desvanecidos:
   * un mapa lleno de información vencida es peor que un mapa vacío, porque
   * quien lo consulta cree que sigue vigente.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minConfidence?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number;

  /** Solo lo que cambió después de esta revisión, para sincronización delta. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  sinceRevision?: string;
}

export class NearbyZonesDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(200_000)
  radiusMeters?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
