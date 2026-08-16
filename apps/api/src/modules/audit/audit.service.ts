import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditEntry {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  /**
   * Registra un acceso o una decision sobre datos personales.
   *
   * Acepta el EntityManager de una transaccion en curso para que la bitacora se
   * escriba en el mismo commit que la accion auditada: un registro de auditoria
   * que puede quedar desincronizado de lo que documenta no sirve como prueba.
   *
   * Un fallo al auditar no tumba la operacion de negocio. En una emergencia,
   * perder la confirmacion de un match porque la bitacora fallo seria peor que
   * perder la linea de bitacora; el error queda en el log del servidor.
   */
  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLog) : this.repo;
    try {
      await repo.insert({
        actorId: entry.actorId ?? null,
        actorName: entry.actorName ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        // El cast es necesario porque TypeORM interpreta un Record<string, unknown>
        // como un mapa de columnas y no como el contenido de una columna jsonb.
        metadata: (entry.metadata ?? {}) as AuditLog['metadata'] & object,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      });
    } catch (error) {
      this.logger.error(
        `No se pudo registrar en bitácora ${entry.action} sobre ${entry.entityType}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async listForEntity(entityType: string, entityId: string, limit = 100): Promise<AuditLog[]> {
    return this.repo.find({
      where: { entityType, entityId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * La ultima vez que se hizo `action` sobre cada uno de esos registros.
   *
   * Sirve para reconstruir el porque de una decision sin duplicar ese dato en la
   * tabla del negocio. El caso concreto: al retirar un reporte de la vista
   * publica, el motivo se queda aqui en lugar de escribirse encima de las notas
   * que dejo la familia. La bitacora ya es la fuente de verdad de quien hizo
   * que; leerla de vuelta evita tener dos.
   *
   * Una sola consulta para todos los ids: la pantalla que la usa muestra
   * decenas de filas y no puede hacer una consulta por cada una.
   */
  async latestFor(
    entityType: string,
    entityIds: string[],
    action: string,
  ): Promise<Map<string, AuditLog>> {
    if (!entityIds.length) return new Map();

    const filas = await this.repo.find({
      where: { entityType, action, entityId: In(entityIds) },
      order: { createdAt: 'DESC' },
    });

    // La consulta viene de la mas nueva a la mas vieja, asi que la primera de
    // cada id es la ultima que ocurrio.
    const porId = new Map<string, AuditLog>();
    for (const fila of filas) {
      if (fila.entityId && !porId.has(fila.entityId)) porId.set(fila.entityId, fila);
    }
    return porId;
  }
}
