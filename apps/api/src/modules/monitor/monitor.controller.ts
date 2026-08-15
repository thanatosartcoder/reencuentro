import { Controller, Get, Headers, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import { BackupService } from 'src/modules/backup/backup.service';

/**
 * Estado operativo para vigilancia externa.
 *
 * Separado de `/health` a propósito. Railway usa `/health` para decidir si
 * reinicia el contenedor: colgarle comprobaciones que consultan almacenamiento
 * de objetos convertiría una copia lenta en un bucle de reinicios, y tumbar la
 * plataforma por vigilarla es el peor de los desenlaces.
 *
 * Va con llave porque lo que responde es un mapa de dónde duele: si las copias
 * llevan días fallando, quien lo sepa sabe que un borrado sería irreversible.
 * Sin la llave responde 404, no 401 — anunciar que el endpoint existe ya es
 * decir algo.
 */
@Controller('estado-operativo')
@SkipThrottle()
export class MonitorController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly backup: BackupService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async check(@Headers('x-monitor-key') key?: string) {
    this.assertKey(key);

    const problemas: string[] = [];

    // --- Base de datos ---
    let postgis: string | null = null;
    try {
      const [row] = await this.dataSource.query<{ postgis: string }[]>(
        'SELECT postgis_version() AS postgis',
      );
      postgis = row.postgis;
    } catch {
      problemas.push('La base de datos no responde.');
    }

    // --- Copias de seguridad ---
    let respaldoHoras: number | null = null;
    try {
      const copias = await this.backup.list();
      if (copias.length === 0) {
        problemas.push('No existe ninguna copia de seguridad.');
      } else {
        respaldoHoras = Math.floor(
          (Date.now() - copias[0].lastModified.getTime()) / 3_600_000,
        );
        // La copia corre cada noche; el margen evita alarmar por un retraso.
        if (respaldoHoras > 36) {
          problemas.push(
            `La última copia de seguridad tiene ${respaldoHoras} horas.`,
          );
        }
      }
    } catch {
      problemas.push('No se pudo consultar el almacenamiento de copias.');
    }

    // --- Cola de validación ---
    //
    // No es un fallo técnico, y por eso conviene vigilarla: una coincidencia
    // sin revisar es una familia esperando. Si nadie valida durante un día, el
    // sistema funciona perfectamente y no sirve para nada.
    let pendientes: number | null = null;
    let esperaMasAntiguaHoras: number | null = null;
    try {
      const [row] = await this.dataSource.query<
        [{ total: string; horas: number | null }]
      >(`
        SELECT count(*)::text AS total,
               FLOOR(EXTRACT(EPOCH FROM (now() - MIN("createdAt"))) / 3600) AS horas
        FROM match_candidates
        WHERE status = 'PENDING_REVIEW'
      `);
      pendientes = Number(row.total);
      esperaMasAntiguaHoras = row.horas === null ? null : Number(row.horas);

      if (esperaMasAntiguaHoras !== null && esperaMasAntiguaHoras > 24) {
        problemas.push(
          `Hay ${pendientes} coincidencia(s) sin revisar; la más antigua lleva ${esperaMasAntiguaHoras} horas.`,
        );
      }
    } catch {
      problemas.push('No se pudo consultar la cola de validación.');
    }

    // --- Personal capaz de validar ---
    let validadores: number | null = null;
    try {
      const [row] = await this.dataSource.query<[{ total: string }]>(`
        SELECT count(*)::text AS total FROM operators
        WHERE "isActive" = true
          AND "passwordHash" IS NOT NULL
          AND role IN ('ADMIN', 'COORDINATOR', 'VALIDATOR')
      `);
      validadores = Number(row.total);
      if (validadores < 2) {
        problemas.push(
          `Solo hay ${validadores} cuenta(s) activa(s) capaz(ces) de validar.`,
        );
      }
    } catch {
      problemas.push('No se pudo contar el personal acreditado.');
    }

    return {
      sano: problemas.length === 0,
      problemas,
      detalle: {
        postgis,
        respaldoHoras,
        pendientes,
        esperaMasAntiguaHoras,
        validadores,
      },
      hora: new Date().toISOString(),
    };
  }

  /**
   * Comparación en tiempo constante. Sin llave configurada el endpoint no
   * existe: es preferible perder la vigilancia a dejarlo abierto por un
   * despliegue al que se le olvidó la variable.
   */
  private assertKey(provided?: string): void {
    const expected = this.config.get<string>('monitor.key');
    if (!expected) throw new NotFoundException();
    if (!provided) throw new NotFoundException();

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new NotFoundException();
    }
  }
}
