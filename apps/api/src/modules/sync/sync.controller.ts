import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { SyncService } from './sync.service';
import { SyncPushDto } from './dto/sync-push.dto';

class PullQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  sinceRevision?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bbox?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /**
   * Vacía el outbox del cliente.
   *
   * Responde con el resultado por operación, no con un éxito o fallo global: el
   * cliente borra de su cola únicamente lo que quedó confirmado y conserva el
   * resto para el siguiente intento.
   */
  @Post('push')
  @HttpCode(200)
  push(@Body() dto: SyncPushDto) {
    return this.sync.push(dto.operations);
  }

  /** Delta desde la última revisión conocida por el cliente. */
  @Get('pull')
  pull(@Query() query: PullQueryDto) {
    return this.sync.pull(query);
  }

  /** Marca de agua actual, para que un cliente nuevo no descargue todo el histórico. */
  @Get('revision')
  async revision() {
    return { revision: await this.sync.currentRevision(), serverTime: new Date().toISOString() };
  }
}
