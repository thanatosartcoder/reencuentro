import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  async check() {
    // Se verifica PostGIS y no solo la conexión: sin la extensión el mapa y la
    // búsqueda de candidatos dejan de funcionar, y conviene enterarse aquí.
    const [{ postgis }] = await this.dataSource.query<{ postgis: string }[]>(
      'SELECT postgis_version() AS postgis',
    );

    return {
      status: 'ok',
      database: 'ok',
      postgis,
      time: new Date().toISOString(),
    };
  }
}
