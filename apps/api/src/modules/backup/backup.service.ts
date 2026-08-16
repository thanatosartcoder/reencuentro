import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { StorageService } from 'src/modules/storage/storage.service';

/**
 * Tope del volcado ya comprimido.
 *
 * Antes el tope se aplicaba al texto **sin comprimir** (`maxBuffer` de 256 MB) y
 * saltaba unas diez veces antes: el volcado entero llegaba a memoria como
 * cadena, se copiaba a un Buffer y se comprimía, o sea tres copias en el heap
 * del mismo proceso que atiende los reportes. Ahora `pg_dump` va conectado
 * directamente al compresor y solo se sostiene el resultado.
 *
 * Sigue habiendo un tope porque la copia se sube de una vez: subirla por partes
 * exigiría carga multiparte y no vale la pena hasta que haga falta. Cuando este
 * límite se acerque, la respuesta es esa y no subirlo.
 */
const MAX_COMPRESSED_BYTES = 512 * 1024 * 1024;

/** Diez minutos: lo mismo que toleraba la versión anterior. */
const DUMP_TIMEOUT_MS = 10 * 60_000;

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
      const { url, password } = this.databaseUrl();
      const excludes = REGENERABLES.flatMap((t) => ['--exclude-table-data', t]);

      // Formato plano y comprimido aparte, no `-Fc`: un .sql.gz se puede abrir,
      // leer y restaurar con psql en cualquier máquina con Postgres. Un formato
      // propietario obliga a tener la versión correcta de pg_restore el día que
      // haya prisa, y ese día no es el día de descubrir que no la tienes.
      const { body, tablesIncluded } = await this.volcar(url, password, excludes);
      const key = `${PREFIX}reencuentro-${stamp(startedAt)}.sql.gz`;

      await this.storage.put(key, body, 'application/gzip');
      await this.prune();

      const finishedAt = new Date();

      this.logger.log(
        `Copia ${key} · ${(body.length / 1024 / 1024).toFixed(1)} MB · ` +
          `${tablesIncluded} tablas · ${Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)}s · ${trigger}`,
      );

      return { key, bytes: body.length, startedAt, finishedAt, tablesIncluded };
    } finally {
      await this.dataSource.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  }

  /**
   * Ejecuta `pg_dump` con su salida conectada directamente al compresor.
   *
   * La versión anterior esperaba a tener el volcado entero en `stdout` como
   * cadena, lo copiaba a un Buffer y luego lo comprimía: tres representaciones
   * del mismo contenido vivas a la vez en el proceso que atiende los reportes de
   * personas. Aquí `pg_dump` escribe, gzip consume y solo se acumula el
   * resultado comprimido, que es un orden de magnitud menor.
   *
   * Se cuentan las tablas al vuelo, sobre los trozos sin comprimir, porque
   * después ya no hay texto que buscar. El contador tolera que un `CREATE TABLE`
   * quede partido entre dos trozos: se conserva la cola de cada uno.
   */
  private async volcar(
    url: string,
    password: string | null,
    excludes: string[],
  ): Promise<{ body: Buffer; tablesIncluded: number }> {
    const child = spawn('pg_dump', [url, '--no-owner', '--no-privileges', ...excludes], {
      env: {
        ...process.env,
        PGCONNECT_TIMEOUT: '30',
        // La contraseña va por el entorno y no dentro de la URL de conexión.
        // Los argumentos de un proceso los lee cualquiera que pueda mirar `ps`
        // o `/proc/<pid>/cmdline` dentro del contenedor; el entorno de un
        // proceso ajeno, no.
        ...(password ? { PGPASSWORD: password } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const matar = setTimeout(() => child.kill('SIGKILL'), DUMP_TIMEOUT_MS);

    // stderr se recoge acotado: si `pg_dump` falla, su mensaje es lo único que
    // explica por qué, y sin leerlo el fallo aparece como un código de salida
    // desnudo. Sin tope, un error repetido por tabla lo llenaría todo.
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8_192) stderr += chunk.toString('utf8');
    });

    let tablesIncluded = 0;
    let body: Buffer = Buffer.alloc(0);

    /**
     * Cuenta las tablas al pasar y deja seguir los bytes intactos.
     *
     * Va por líneas completas y no por trozos: un trozo puede cortar en mitad de
     * un `CREATE TABLE`, y guardar "los últimos caracteres" para el siguiente
     * hace que un encabezado que cabía entero en esa cola se cuente dos veces.
     * `StringDecoder` evita además romper un carácter multibyte en la frontera.
     */
    const contarTablas = async function* (origen: AsyncIterable<Buffer>) {
      const decoder = new StringDecoder('utf8');
      let resto = '';

      for await (const chunk of origen) {
        const lineas = (resto + decoder.write(chunk)).split('\n');
        // La última puede estar incompleta; espera al siguiente trozo.
        resto = lineas.pop() ?? '';
        for (const linea of lineas) {
          if (linea.startsWith('CREATE TABLE ')) tablesIncluded++;
        }
        yield chunk;
      }

      if ((resto + decoder.end()).startsWith('CREATE TABLE ')) tablesIncluded++;
    };

    /**
     * Acumula la salida ya comprimida.
     *
     * Tiene que ser una etapa de la propia tubería y no un oyente de `data`: con
     * `pipeline(stdout, gzip)` la promesa se resuelve al terminar el lado de
     * escritura, antes de que el compresor emita su cierre — y el resultado es
     * un .gz truncado que solo se descubre el día que hay que restaurarlo.
     */
    const acumular = async (origen: AsyncIterable<Buffer>): Promise<void> => {
      const partes: Buffer[] = [];
      let bytes = 0;

      for await (const chunk of origen) {
        bytes += chunk.length;
        if (bytes > MAX_COMPRESSED_BYTES) {
          child.kill('SIGKILL');
          throw new Error(
            `La copia supera ${Math.round(MAX_COMPRESSED_BYTES / 1024 ** 2)} MB comprimidos. ` +
              'Hay que subirla por partes en lugar de de una vez.',
          );
        }
        partes.push(chunk);
      }

      body = Buffer.concat(partes);
    };

    try {
      await Promise.all([
        pipeline(child.stdout, contarTablas, createGzip({ level: 9 }), acumular),
        new Promise<void>((resolve, reject) => {
          child.on('error', reject);
          child.on('close', (code, signal) => {
            if (code === 0) return resolve();
            reject(
              new Error(
                `pg_dump terminó con ${signal ?? `código ${code}`}` +
                  (stderr.trim() ? `: ${stderr.trim()}` : ''),
              ),
            );
          });
        }),
      ]);
    } finally {
      clearTimeout(matar);
    }

    return { body, tablesIncluded };
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
  private databaseUrl(): { url: string; password: string | null } {
    // La contraseña sale de la URL y viaja aparte, para entregarla por
    // `PGPASSWORD` en lugar de dejarla en los argumentos del proceso.
    const directa = process.env.DATABASE_URL;
    if (directa) return separarContrasena(directa);

    const host = this.config.get<string>('database.host');
    const port = this.config.get<number>('database.port');
    const user = this.config.get<string>('database.username');
    const pass = this.config.get<string>('database.password');
    const name = this.config.get<string>('database.database');

    if (!host || !name) {
      throw new Error('No hay datos de conexión: pg_dump no puede arrancar.');
    }

    return {
      url: `postgresql://${encodeURIComponent(user ?? '')}@${host}:${port}/${name}`,
      password: pass ?? null,
    };
  }
}

/**
 * Quita la contraseña de una URL de conexión y la devuelve aparte.
 *
 * La plataforma inyecta `DATABASE_URL` con la credencial dentro, y esa cadena
 * acababa como argumento de `pg_dump` —visible en `ps` para cualquier proceso
 * del contenedor—. Aquí se separa para pasarla por el entorno.
 *
 * Si la URL viene mal formada se devuelve tal cual: que la copia funcione pesa
 * más que este endurecimiento, y `pg_dump` dará un error más útil que el que
 * daría un parseo fallido aquí.
 */
function separarContrasena(raw: string): { url: string; password: string | null } {
  try {
    const parsed = new URL(raw);
    if (!parsed.password) return { url: raw, password: null };

    const password = decodeURIComponent(parsed.password);
    parsed.password = '';
    return { url: parsed.toString(), password };
  } catch {
    return { url: raw, password: null };
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
