import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { OverviewService } from './overview.service';

class ContextQueryDto {
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
  @Max(100_000)
  radiusMeters?: number;
}

@Controller('mapa')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  /**
   * Panorama por municipio: cuántas personas siguen sin localizar, cuántas vías
   * están cortadas, cuánto edificado está dañado y cuántas réplicas se
   * registraron cerca. Es lo que responde "cómo está este municipio" en vez de
   * "qué hay en este punto".
   */
  @Get('agregado')
  byMunicipality() {
    return this.overview.byMunicipality();
  }

  /** Qué más hay alrededor de un punto del mapa. */
  @Get('contexto')
  context(@Query() query: ContextQueryDto) {
    return this.overview.contextAround(query.lat, query.lon, query.radiusMeters ?? 3_000);
  }
}
