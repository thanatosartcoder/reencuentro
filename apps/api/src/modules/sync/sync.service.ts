import { Injectable, Logger } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PersonsService } from 'src/modules/persons/persons.service';
import { GeoService } from 'src/modules/geo/geo.service';
import { CreateMissingReportDto } from 'src/modules/persons/dto/create-missing-report.dto';
import { CreateSightingDto } from 'src/modules/persons/dto/create-sighting.dto';
import {
  CreateZoneReportDto,
  VoteZoneReportDto,
} from 'src/modules/geo/dto/create-zone-report.dto';
import { ZoneReport } from 'src/modules/geo/entities/zone-report.entity';
import { PushOperation, SyncOperationType } from './dto/sync-push.dto';

export interface PushResult {
  clientUuid: string;
  type: SyncOperationType;
  status: 'created' | 'duplicate' | 'invalid' | 'error';
  id?: string;
  claimToken?: string | null;
  error?: string;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly persons: PersonsService,
    private readonly geo: GeoService,
    @InjectRepository(ZoneReport)
    private readonly zoneRepo: Repository<ZoneReport>,
  ) {}

  /**
   * Vacía el outbox de un cliente.
   *
   * Cada operación se procesa por separado y su fallo no arrastra a las demás.
   * Esto es deliberado: un dispositivo que pasó tres días sin señal puede
   * enviar cincuenta reportes de golpe, y que uno malformado invalide los otros
   * cuarenta y nueve sería inaceptable. El cliente recibe el resultado de cada
   * uno y solo borra de su cola los que quedaron confirmados.
   *
   * La idempotencia por `clientUuid` la garantiza cada servicio, así que
   * reenviar el lote entero tras un corte a medias no duplica nada.
   */
  async push(operations: PushOperation[]): Promise<{ results: PushResult[]; maxRevision: string }> {
    const results: PushResult[] = [];

    for (const operation of operations) {
      try {
        results.push(await this.applyOperation(operation));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Operación ${operation.clientUuid} falló: ${message}`);
        results.push({
          clientUuid: operation.clientUuid,
          type: operation.type,
          status: 'error',
          error: message,
        });
      }
    }

    return { results, maxRevision: await this.currentRevision() };
  }

  private async applyOperation(operation: PushOperation): Promise<PushResult> {
    const base = { clientUuid: operation.clientUuid, type: operation.type };

    switch (operation.type) {
      case SyncOperationType.MISSING_REPORT: {
        const dto = await this.validateAs(CreateMissingReportDto, operation.payload);
        if (typeof dto === 'string') return { ...base, status: 'invalid', error: dto };

        const result = await this.persons.createMissingReport(dto);
        return {
          ...base,
          status: result.duplicate ? 'duplicate' : 'created',
          id: result.report.id,
          claimToken: result.claimToken,
        };
      }

      case SyncOperationType.SIGHTING: {
        const dto = await this.validateAs(CreateSightingDto, operation.payload);
        if (typeof dto === 'string') return { ...base, status: 'invalid', error: dto };

        const result = await this.persons.createSighting(dto);
        return {
          ...base,
          status: result.duplicate ? 'duplicate' : 'created',
          id: result.report.id,
          claimToken: result.claimToken,
        };
      }

      case SyncOperationType.ZONE_REPORT: {
        const dto = await this.validateAs(CreateZoneReportDto, operation.payload);
        if (typeof dto === 'string') return { ...base, status: 'invalid', error: dto };

        const result = await this.geo.createReport(dto);
        return {
          ...base,
          status: result.duplicate ? 'duplicate' : 'created',
          id: result.report.id,
        };
      }

      case SyncOperationType.ZONE_VOTE: {
        const dto = await this.validateAs(VoteZoneReportDto, operation.payload);
        if (typeof dto === 'string') return { ...base, status: 'invalid', error: dto };

        const targetId = operation.targetId;
        if (!targetId) {
          return { ...base, status: 'invalid', error: 'targetId es obligatorio para un voto' };
        }

        const report = await this.geo.vote(targetId, dto);
        return { ...base, status: 'created', id: report.id };
      }

      default:
        return { ...base, status: 'invalid', error: `Tipo de operación desconocido` };
    }
  }

  /**
   * Valida el payload con el mismo DTO que usa el endpoint HTTP equivalente.
   *
   * Reutilizar las reglas evita que la ruta de sincronización se convierta en
   * una puerta trasera con validación más laxa que la del formulario online.
   */
  private async validateAs<T extends object>(
    cls: new () => T,
    payload: unknown,
  ): Promise<T | string> {
    const instance = plainToInstance(cls, payload, { enableImplicitConversion: false });
    const errors = await validate(instance as object, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });

    if (errors.length) {
      return errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .filter(Boolean)
        .join('; ');
    }
    return instance;
  }

  /**
   * Cambios posteriores a una revisión dada.
   *
   * El cursor es la revisión global, no una marca de tiempo: da un orden total
   * entre tablas y avanza también en las ediciones, de modo que el cliente no
   * puede perderse un cambio por un empate de reloj ni por una fila actualizada.
   */
  async pull(options: {
    sinceRevision?: string;
    bbox?: string;
    limit?: number;
  }): Promise<{ zones: unknown[]; maxRevision: string; hasMore: boolean }> {
    const limit = options.limit ?? 500;

    const { items } = await this.geo.query({
      sinceRevision: options.sinceRevision,
      bbox: options.bbox,
      limit: limit + 1,
      // En un pull de sincronización se entrega todo lo que cambió, incluso lo
      // ya desvanecido: el cliente necesita saber que un reporte que tiene
      // guardado dejó de ser confiable, y filtrarlo aquí lo dejaría con una
      // copia obsoleta que nunca se corrige.
      minConfidence: 0,
    });

    const hasMore = items.length > limit;
    const zones = hasMore ? items.slice(0, limit) : items;

    const maxRevision = zones.length
      ? zones.reduce((max, z) => (BigInt(z.revision) > BigInt(max) ? z.revision : max), '0')
      : (options.sinceRevision ?? '0');

    return { zones, maxRevision, hasMore };
  }

  /** Revisión más alta emitida. El cliente la guarda como su marca de agua. */
  async currentRevision(): Promise<string> {
    const row = await this.zoneRepo
      .createQueryBuilder('z')
      .select('COALESCE(MAX(z.revision), 0)', 'max')
      .getRawOne<{ max: string }>();
    return row?.max ?? '0';
  }
}
