import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { StorageService } from 'src/modules/storage/storage.service';

const run = promisify(execFile);
const compress = promisify(gzip);

/**
 * Copia de seguridad de lo que las personas pusieron aquí.
 *
 * Railway ofrece recuperación a un punto en el tiempo, pero solo sobre su
 * imagen oficial de Postgres; esta base corre PostGIS de la comunidad, así que
 * no está disponible. Sin esto no habría copia ninguna: si se pierde el
 * volumen, se pierde lo que una familia contó sobre su hija, y eso no se
 * regenera pidiéndoselo otra vez.
 *
 * **Qué se copia y qué no.** Se excluyen los datos de las capas que vienen de
 * fuera —vías de HOT, daño de HDX, sismos del USGS— porque sus cron las vuelven
 * a traer idénticas. Eso no es ahorrar espacio por avaricia: son con diferencia
 * las tablas más grandes, y arrastrarlas convertiría la copia en algo tan
 * pesado que fallaría en silencio justo el día que hiciera falta. Se excluyen
 * **los datos, no las tablas**: el esquema viaja entero, así que un restore
 * deja la base lista y el primer cron la rellena.
 *
 * Lo que sí viaja es todo lo que nadie puede volver a generar: reportes de
 * desaparición, avistamientos, votos del mapa, las decisiones de validación y
 * la bitácora de auditoría, que además hay que poder mostrar por ley.
 */

/** Tablas que las ingestas reconstruyen solas. Se copia su esquema, no sus filas. */
const REGENERABLES = [
  'road_segments',
  'damage_assessments',
  'damage_coverage',
  'seismic_events',
  // No es nuestra: la crea PostGIS con sus ~8.500 sistemas de referencia. Sus
  // filas ya están en la base destino y volcarlas solo produce conflictos al
  // restaurar.
  'spatial_ref_sys',
];

/** Copias que se conservan. Dos semanas cubre un daño que se note tarde. */
const RETENTION = 14;

const PREFIX = 'backups/';

/** Clave del advisory lock. Arbitraria pero estable. */
const LOCK_KEY = 947_112_003;

export interface BackupRun {
  key: string;
  bytes: number;
  startedAt: Date;
  finishedAt: Date;
  tablesIncluded: number;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  /**
   * De madrugada, antes que las ingestas.
   *
   * Va primero a propósito: si una ingesta corrompiera una capa, la copia de
   * esa noche todavía es anterior al destrozo.
   */
  @Cron('0 40 2 * * *', { name: 'backup-database' })
  async scheduled(): Promise<void> {
    if (this.config.get<boolean>('backup.cronEnabled') === false) return;
    try {
      await this.run('cron');
    } catch (error) {
      this.logger.error(
        `La copia de seguridad falló: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async run(trigger: 'cron' | 'manual'): Promise<BackupRun> {
    const startedAt = new Date();

    // Dos instancias copiando a la vez pagarían dos veces por lo mismo y
    // competirían por la memoria del contenedor.
    const [{ locked }] = await this.dataSource.query<[{ locked: boolean }]>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [LOCK_KEY],
    );
    if (!locked) {
      throw new Error('Ya hay una copia de seguridad en curso.');
    }

    try {
      const url = this.databaseUrl();
      const excludes = REGENERABLES.flatMap((t) => ['--exclude-table-data', t]);

      // Formato plano y comprimido aparte, no `-Fc`: un .sql.gz se puede abrir,
      // leer y restaurar con psql en cualquier máquina con Postgres. Un formato
      // propietario obliga a tener la versión correcta de pg_restore el día que
      // haya prisa, y ese día no es el día de descubrir que no la tienes.
      const { stdout } = await run(
        'pg_dump',
        [
          url,
          '--no-owner',
          '--no-privileges',
          ...excludes,
        ],
        {
          // Un volcado grande no puede tumbar el proceso que atiende reportes.
          maxBuffer: 256 * 1024 * 1024,
          timeout: 10 * 60_000,
          env: { ...process.env, PGCONNECT_TIMEOUT: '30' },
        },
      );

      const body = await compress(Buffer.from(stdout, 'utf8'), { level: 9 });
      const key = `${PREFIX}reencuentro-${stamp(startedAt)}.sql.gz`;

      await this.storage.put(key, body, 'application/gzip');
      await this.prune();

      const finishedAt = new Date();
      const tablesIncluded = (stdout.match(/^CREATE TABLE /gm) ?? []).length;

      this.logger.log(
        `Copia ${key} · ${(body.length / 1024 / 1024).toFixed(1)} MB · ` +
          `${tablesIncluded} tablas · ${Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)}s · ${trigger}`,
      );

      return { key, bytes: body.length, startedAt, finishedAt, tablesIncluded };
    } finally {
      await this.dataSource.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  }

  /** Copias guardadas, de la más nueva a la más vieja. */
  async list(): Promise<{ key: string; size: number; lastModified: Date }[]> {
    return this.storage.list(PREFIX);
  }

  /**
   * Borra las que sobran de la retención.
   *
   * Se ejecuta **después** de subir la nueva, nunca antes: si el volcado
   * fallara, prefiero pagar una copia de más a haber borrado la última buena.
   */
  private async prune(): Promise<void> {
    const copias = await this.storage.list(PREFIX);
    for (const vieja of copias.slice(RETENTION)) {
      await this.storage.delete(vieja.key);
      this.logger.log(`Copia retirada por antigüedad: ${vieja.key}`);
    }
  }

  /**
   * Cadena de conexión para `pg_dump`.
   *
   * Se prefiere `DATABASE_URL` porque es lo que inyecta la plataforma y es la
   * verdad sobre dónde vive la base. Si no está, se arma desde los mismos
   * campos que usa TypeORM, para que la copia no dependa de configurar una
   * variable extra en desarrollo.
   */
  private databaseUrl(): string {
    const directa = process.env.DATABASE_URL;
    if (directa) return directa;

    const host = this.config.get<string>('database.host');
    const port = this.config.get<number>('database.port');
    const user = this.config.get<string>('database.username');
    const pass = this.config.get<string>('database.password');
    const name = this.config.get<string>('database.database');

    if (!host || !name) {
      throw new Error('No hay datos de conexión: pg_dump no puede arrancar.');
    }

    // La contraseña se codifica: un `@` o un `/` sin escapar parten la URL y
    // el fallo aparece como "host desconocido", que no ayuda a nadie.
    return `postgresql://${encodeURIComponent(user ?? '')}:${encodeURIComponent(
      pass ?? '',
    )}@${host}:${port}/${name}`;
  }
}

/** `2026-08-15-0240`, ordenable alfabéticamente y legible. */
function stamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}`
  );
}
