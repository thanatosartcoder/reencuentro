import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentOperator, OperatorGuard, Roles } from 'src/modules/auth/auth.guard';
import { OperatorClaims } from 'src/modules/auth/auth.service';
import { OperatorRole } from 'src/modules/auth/entities/operator.entity';
import { AuditService } from 'src/modules/audit/audit.service';
import { BackupService } from './backup.service';

/**
 * Estado de las copias de seguridad.
 *
 * No es una pantalla de administración por completismo: una copia que lleva
 * días fallando en silencio es peor que no tener copias, porque se cree que
 * están. Por eso lo que se muestra es **cuándo fue la última**, no un botón.
 */
@Controller('respaldos')
export class BackupController {
  constructor(
    private readonly backup: BackupService,
    private readonly audit: AuditService,
  ) {}

  @Get('estado')
  @UseGuards(OperatorGuard)
  @Roles(OperatorRole.COORDINATOR)
  async status() {
    const copias = await this.backup.list();
    const ultima = copias[0] ?? null;

    return {
      total: copias.length,
      ultima: ultima
        ? {
            clave: ultima.key,
            bytes: ultima.size,
            fecha: ultima.lastModified,
            // Que la interfaz no tenga que calcularlo para poder avisar.
            horasDesde: Math.floor(
              (Date.now() - ultima.lastModified.getTime()) / 3_600_000,
            ),
          }
        : null,
      copias: copias.slice(0, 14).map((c) => ({
        clave: c.key,
        bytes: c.size,
        fecha: c.lastModified,
      })),
    };
  }

  /**
   * Lanza una copia a mano.
   *
   * Para antes de una migración delicada: tener la copia de anoche no consuela
   * si el cambio se aplicó esta mañana.
   */
  @Post('ejecutar')
  @HttpCode(200)
  @UseGuards(OperatorGuard)
  @Roles(OperatorRole.COORDINATOR)
  async run(@CurrentOperator() operator: OperatorClaims) {
    await this.audit.record({
      actorId: operator.sub,
      actorName: operator.name,
      action: 'RUN_BACKUP',
      entityType: 'Backup',
    });

    const resultado = await this.backup.run('manual');

    return {
      clave: resultado.key,
      bytes: resultado.bytes,
      tablas: resultado.tablesIncluded,
      segundos: Math.round(
        (resultado.finishedAt.getTime() - resultado.startedAt.getTime()) / 1000,
      ),
    };
  }
}
