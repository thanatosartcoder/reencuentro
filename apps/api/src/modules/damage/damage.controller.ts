import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DamageService } from './damage.service';

class QueryDamageDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bbox?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onlyDamaged?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;

  /** Emergencia a consultar. Si no viene, la que esté en curso. */
  @IsOptional()
  @IsString()
  @Length(3, 120)
  evento?: string;
}

@Controller('danos')
export class DamageController {
  constructor(private readonly damage: DamageService) {}

  @Get()
  async query(@Query() query: QueryDamageDto) {
    const items = await this.damage.query(query);
    return {
      items,
      total: items.length,
      fuente: 'Microsoft AI for Good Lab · Humanitarian Data Exchange',
      // El aviso viaja con los datos, no solo en la interfaz: cualquiera que
      // consuma esta API tiene que saber que son estimaciones de un modelo.
      aviso:
        'Estimación automática de un modelo sobre imagen satelital. No es una ' +
        'inspección estructural y no determina habitabilidad.',
    };
  }

  @Get('resumen')
  summary(@Query('evento') evento?: string) {
    return this.damage.summary(evento);
  }

  /**
   * Áreas con evaluación publicada. Sirve para dibujar en el mapa dónde se ha
   * mirado, y por diferencia, dónde no.
   */
  @Get('cobertura')
  async coverage(@Query('evento') evento?: string) {
    const items = await this.damage.coverage(evento);
    return {
      items,
      total: items.length,
      aviso:
        'Fuera de estas áreas no hay evaluación de daño publicada. ' +
        'Que un lugar no aparezca marcado no significa que esté intacto.',
    };
  }
}
