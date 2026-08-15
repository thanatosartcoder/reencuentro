import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IngestRun, IngestSource, IngestStatus } from './entities/ingest-run.entity';
import { ingestHdxDamage, DAMAGE_DATASETS } from './hdx-damage.ingester';
import { ingestHotRoads, HOT_ROADS_DATASET_ID } from './hot-roads.ingester';
import { fetchHdxVersion, type IngestLogger } from './hdx-client';
import { EventsService } from 'src/modules/events/events.service';

/**
 * Programación de las ingestas de fuentes externas.
 *
 * Son datasets que se republican cada varios días, no feeds: corren de
 * madrugada y solo cuando la fuente cambió. Tres salvaguardas hacen que un cron
 * que descarga cientos de megabytes sea seguro de dejar desatendido:
 *
 * 1. **Detección de cambios.** Se consulta la versión publicada en HDX antes de
 *    descargar. Si coincide con la ya cargada, no se baja nada. Sin esto se
 *    gastarían 160 MB cada noche —de HDX, que es una plataforma humanitaria sin
 *    ánimo de lucro— para reescribir los mismos datos.
 *
 * 2. **Bloqueo entre instancias.** Un advisory lock de Postgres evita que dos
 *    réplicas de la API hagan la misma descarga a la vez.
 *
 * 3. **Carga atómica.** Cada ingesta reemplaza sus datos dentro de una
 *    transacción, así que un fallo a mitad de camino deja intacto lo anterior
 *    en vez de un mapa a medias.
 *
 * Las dos se separan una hora para no solapar descargas grandes ni competir por
 * disco.
 */

/** Claves del advisory lock. Arbitrarias pero estables. */
const LOCK_KEYS: Record<IngestSource, number> = {
  [IngestSource.HDX_DAMAGE]: 826_001,
  [IngestSource.HOT_ROADS]: 826_002,
};

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(IngestRun) private readonly runs: Repository<IngestRun>,
    private readonly events: EventsService,
  ) {}

  private get enabled(): boolean {
    // Se puede apagar sin tocar código: en un despliegue de desarrollo o en una
    // réplica de solo lectura no tiene sentido que corra.
    return (process.env.INGEST_CRON_ENABLED ?? 'true') !== 'false';
  }

  /** Evaluaciones de daño de HDX. 03:20, antes que la red vial. */
  @Cron('0 20 3 * * *', { name: 'ingest-hdx-damage' })
  async cronDamage(): Promise<void> {
    if (!this.enabled) return;
    await this.run(IngestSource.HDX_DAMAGE, 'cron');
  }

  /** Red vial de HOT. 04:20, con margen sobre la anterior. */
  @Cron('0 20 4 * * *', { name: 'ingest-hot-roads' })
  async cronRoads(): Promise<void> {
    if (!this.enabled) return;
    await this.run(IngestSource.HOT_ROADS, 'cron');
  }

  /**
   * Ejecuta una ingesta con bloqueo, detección de cambios y registro.
   *
   * `force` salta la detección de cambios: sirve para recargar tras corregir un
   * error de ingesta, cuando la fuente no cambió pero lo cargado está mal.
   */
  async run(
    source: IngestSource,
    trigger: 'cron' | 'manual',
    options: { force?: boolean } = {},
  ): Promise<IngestRun> {
    const lockKey = LOCK_KEYS[source];
    const [{ locked }] = await this.dataSource.query<{ locked: boolean }[]>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [lockKey],
    );

    if (!locked) {
      this.logger.warn(`${source}: otra instancia ya la está ejecutando, se omite`);
      return this.record(source, trigger, IngestStatus.SKIPPED, {
        error: 'Otra instancia tenía el bloqueo',
      });
    }

    const startedAt = new Date();

    try {
      // --- Detección de cambios ---
      if (!options.force) {
        const datasetId =
          source === IngestSource.HOT_ROADS ? HOT_ROADS_DATASET_ID : DAMAGE_DATASETS[0].datasetId;
        const published = await fetchHdxVersion(datasetId);
        const last = await this.lastSuccess(source);

        if (published && last?.sourceVersion === published) {
          this.logger.log(`${source}: sin cambios en el origen (${published}), se omite`);
          return this.record(source, trigger, IngestStatus.SKIPPED, {
            sourceVersion: published,
            startedAt,
          });
        }
      }

      this.logger.log(`${source}: iniciando ingesta (${trigger})`);
      const ingestLogger: IngestLogger = {
        log: (message) => this.logger.log(message.trim()),
        warn: (message) => this.logger.warn(message.trim()),
      };

      const result =
        source === IngestSource.HOT_ROADS
          ? await ingestHotRoads(this.dataSource, {
              logger: ingestLogger,
              force: options.force,
            }).then((r) => ({
              records: r.inserted,
              bytes: r.bytesDownloaded,
              version: r.sourceVersion,
            }))
          : await ingestHdxDamage(this.dataSource, {
              logger: ingestLogger,
              force: options.force,
              // El daño describe una emergencia concreta: sin evento no se
              // sabría en qué mapa mostrarlo.
              eventId: await this.events.primaryId(),
            }).then((r) => ({
              records: r.inserted,
              bytes: r.bytesDownloaded,
              version: r.sourceVersion,
            }));

      this.logger.log(
        `${source}: ${result.records.toLocaleString('es-CO')} registros cargados en ` +
          `${Math.round((Date.now() - startedAt.getTime()) / 1000)} s`,
      );

      return this.record(source, trigger, IngestStatus.SUCCESS, {
        sourceVersion: result.version,
        recordsLoaded: result.records,
        bytesDownloaded: result.bytes,
        startedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // El fallo se registra y no se relanza: una ingesta caída no puede tumbar
      // el proceso que atiende los reportes de personas.
      this.logger.error(`${source}: la ingesta falló — ${message}`);
      return this.record(source, trigger, IngestStatus.FAILED, { error: message, startedAt });
    } finally {
      await this.dataSource.query('SELECT pg_advisory_unlock($1)', [lockKey]);
    }
  }

  private async record(
    source: IngestSource,
    trigger: 'cron' | 'manual',
    status: IngestStatus,
    extra: {
      sourceVersion?: string | null;
      recordsLoaded?: number;
      bytesDownloaded?: number;
      error?: string;
      startedAt?: Date;
    } = {},
  ): Promise<IngestRun> {
    const startedAt = extra.startedAt ?? new Date();
    const finishedAt = new Date();

    return this.runs.save(
      this.runs.create({
        source,
        status,
        trigger,
        sourceVersion: extra.sourceVersion ?? null,
        recordsLoaded: extra.recordsLoaded ?? null,
        bytesDownloaded: extra.bytesDownloaded ?? null,
        error: extra.error ?? null,
        startedAt,
        finishedAt,
        durationSeconds: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
      }),
    );
  }

  private lastSuccess(source: IngestSource): Promise<IngestRun | null> {
    return this.runs.findOne({
      where: { source, status: IngestStatus.SUCCESS },
      order: { startedAt: 'DESC' },
    });
  }

  /**
   * Estado de cada fuente, para que la interfaz pueda decir cuándo se actualizó
   * cada capa. Un dato externo sin fecha de carga es un dato en el que no se
   * puede confiar.
   */
  async status(): Promise<{
    fuentes: {
      fuente: IngestSource;
      ultimaCargaExitosa: string | null;
      versionOrigen: string | null;
      registros: number | null;
      ultimoIntento: { estado: IngestStatus; cuando: string; error: string | null } | null;
    }[];
    cronActivo: boolean;
    horarios: Record<string, string>;
  }> {
    const fuentes = await Promise.all(
      Object.values(IngestSource).map(async (source) => {
        const [success, latest] = await Promise.all([
          this.lastSuccess(source),
          this.runs.findOne({ where: { source }, order: { startedAt: 'DESC' } }),
        ]);

        return {
          fuente: source,
          ultimaCargaExitosa: success?.finishedAt?.toISOString() ?? null,
          versionOrigen: success?.sourceVersion ?? null,
          registros: success?.recordsLoaded ?? null,
          ultimoIntento: latest
            ? {
                estado: latest.status,
                cuando: latest.startedAt.toISOString(),
                error: latest.error,
              }
            : null,
        };
      }),
    );

    return {
      fuentes,
      cronActivo: this.enabled,
      horarios: {
        [IngestSource.HDX_DAMAGE]: '03:20 diario',
        [IngestSource.HOT_ROADS]: '04:20 diario',
      },
    };
  }

  /** Purga el historial viejo: la bitácora sirve para diagnosticar, no para archivar. */
  @Cron('0 40 4 * * *', { name: 'ingest-purge-history' })
  async purgeHistory(): Promise<void> {
    const cutoff = new Date(Date.now() - 90 * 24 * 3_600_000);
    const result = await this.runs
      .createQueryBuilder()
      .delete()
      .where('"startedAt" < :cutoff', { cutoff })
      .execute();

    if (result.affected) {
      this.logger.log(`Purgadas ${result.affected} ejecuciones de ingesta antiguas`);
    }
  }
}
