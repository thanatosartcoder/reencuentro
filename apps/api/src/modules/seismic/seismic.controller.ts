import { Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SkipThrottle } from '@nestjs/throttler';
import { OperatorGuard, Roles } from 'src/modules/auth/auth.guard';
import { OperatorRole } from 'src/modules/auth/entities/operator.entity';
import { SeismicService } from './seismic.service';

class QuerySeismicDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bbox?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10)
  minMagnitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  sinceHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number;

  /** Emergencia a consultar. Si no viene, la que esté en curso. */
  @IsOptional()
  @IsString()
  @Length(3, 120)
  evento?: string;
}

@Controller('sismos')
export class SeismicController {
  constructor(private readonly seismic: SeismicService) {}

  /** Réplicas para la capa sísmica del mapa. */
  @Get('replicas')
  async list(@Query() query: QuerySeismicDto) {
    const items = await this.seismic.list(query);
    return {
      items,
      total: items.length,
      fuente: 'USGS · earthquake.usgs.gov',
      aviso:
        'Soluciones del USGS. El Servicio Geológico Colombiano es la autoridad ' +
        'oficial para sismos en territorio colombiano y sus cifras pueden diferir.',
    };
  }

  @Get('resumen')
  @SkipThrottle()
  summary() {
    return this.seismic.summary();
  }

  /** Fuerza una sincronización. Útil tras una réplica sentida, sin esperar al cron. */
  @Post('sincronizar')
  @HttpCode(200)
  @UseGuards(OperatorGuard)
  @Roles(OperatorRole.COORDINATOR)
  sync() {
    return this.seismic.sync();
  }
}
