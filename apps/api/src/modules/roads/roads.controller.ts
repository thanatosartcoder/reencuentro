import { Controller, Get, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { OSM_ATTRIBUTION, RoadsService } from './roads.service';

class QueryRoadsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bbox?: string;

  /** Lista separada por comas: trunk,primary,secondary… */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value,
  )
  highways?: string[];

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  namedOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8000)
  limit?: number;
}

class NearbyRoadsDto {
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
  @Min(50)
  @Max(20_000)
  radiusMeters?: number;
}

class SearchRoadsDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  q: string;
}

@Controller('vias')
export class RoadsController {
  constructor(private readonly roads: RoadsService) {}

  /** Tramos de la ventana visible, con el detalle acorde a la escala. */
  @Get()
  async query(@Query() query: QueryRoadsDto) {
    const items = await this.roads.query(query);
    return { items, total: items.length, atribucion: OSM_ATTRIBUTION };
  }

  /**
   * Vías con nombre cerca de un punto.
   *
   * Alimenta el autocompletado al reportar: elegir el nombre de una lista real
   * hace que dos reportes sobre la misma carretera se puedan agrupar.
   */
  @Get('cerca')
  async nearby(@Query() query: NearbyRoadsDto) {
    const items = await this.roads.nearby(query.lat, query.lon, query.radiusMeters ?? 1_500);
    return { items, atribucion: OSM_ATTRIBUTION };
  }

  @Get('buscar')
  async search(@Query() query: SearchRoadsDto) {
    const items = await this.roads.searchByName(query.q);
    return { items, atribucion: OSM_ATTRIBUTION };
  }

  /** Inventario vial de un área: km de red, superficie y puentes. */
  @Get('resumen')
  summary(@Query('bbox') bbox?: string) {
    return this.roads.summary(bbox);
  }
}
