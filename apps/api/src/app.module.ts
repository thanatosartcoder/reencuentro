import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { configuration } from './config/configuration';
import { dataSourceOptions } from './database/data-source';
import { StorageModule } from './modules/storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PersonsModule } from './modules/persons/persons.module';
import { GeoModule } from './modules/geo/geo.module';
import { SyncModule } from './modules/sync/sync.module';
import { SituationModule } from './modules/situation/situation.module';
// Fuentes externas: réplicas del USGS y evaluación de daño publicada en HDX.
import { SeismicModule } from './modules/seismic/seismic.module';
import { DamageModule } from './modules/damage/damage.module';
// Puente hacia los registros oficiales.
import { ExportModule } from './modules/export/export.module';
// Red vial de OpenStreetMap: qué vías existen, no cuáles están transitables.
import { RoadsModule } from './modules/roads/roads.module';
// Agregación territorial que cruza todos los módulos anteriores.
import { OverviewModule } from './modules/overview/overview.module';
// Programación diaria de las ingestas de fuentes externas.
import { IngestModule } from './modules/ingest/ingest.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => ({
        ...dataSourceOptions,
        host: config.get<string>('database.host') ?? dataSourceOptions.host,
        port: config.get<number>('database.port') ?? dataSourceOptions.port,
        username: config.get<string>('database.username') ?? dataSourceOptions.username,
        password: config.get<string>('database.password') ?? dataSourceOptions.password,
        database: config.get<string>('database.database') ?? dataSourceOptions.database,
        logging: config.get<boolean>('database.logging') ?? false,
        autoLoadEntities: true,
      }),
    }),

    // Los cron del despachador de notificaciones y del vencimiento de zonas.
    ScheduleModule.forRoot(),

    /**
     * Límite de peticiones. Alto a propósito: en una emergencia hay picos
     * legítimos de tráfico desde una misma IP (una sala de crisis, un albergue
     * con wifi compartido, un operador móvil con NAT), y bloquear a quien
     * reporta sería peor que absorber algo de abuso.
     */
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 20 },
      { name: 'long', ttl: 60_000, limit: 300 },
    ]),

    StorageModule,
    AuthModule,
    AuditModule,
    NotificationsModule,
    PersonsModule,
    GeoModule,
    SyncModule,
    SituationModule,
    SeismicModule,
    DamageModule,
    ExportModule,
    RoadsModule,
    OverviewModule,
    IngestModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
