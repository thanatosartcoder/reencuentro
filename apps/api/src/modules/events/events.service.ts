import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { fromGeoPoint } from 'src/common/geo/geo.util';
import { officialFiguresFor } from 'src/modules/situation/situation.data';
import { EventEntity, EventStatus } from './entities/event.entity';

/**
 * Consulta de emergencias cubiertas.
 *
 * El evento es una fila para poder cubrir la siguiente sin desplegar una copia
 * de la plataforma. Sus cifras oficiales siguen viviendo en código: aquí solo
 * se juntan al servirlas.
 */

export interface EventView {
  slug: string;
  nombre: string;
  tipo: string;
  ocurrioEl: Date;
  estado: EventStatus;
  principal: boolean;
  epicentro: { latitud: number; longitud: number } | null;
  radioKm: number | null;
  departamentos: string[];
  /** false cuando aún no hay balance oficial publicado. */
  tieneCifrasOficiales: boolean;
}

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(EventEntity)
    private readonly repo: Repository<EventEntity>,
  ) {}

  /** Emergencias cubiertas, la activa primero y luego por fecha. */
  async list(): Promise<EventView[]> {
    const rows = await this.repo
      .createQueryBuilder('e')
      .orderBy('e.isPrimary', 'DESC')
      .addOrderBy('e.occurredAt', 'DESC')
      .getMany();

    return rows.map((row) => toView(row));
  }

  async bySlug(slug: string): Promise<EventView> {
    const row = await this.repo.findOne({ where: { slug } });
    if (!row) throw new NotFoundException('No se cubre ninguna emergencia con ese identificador.');
    return toView(row);
  }

  /**
   * El evento que se muestra al entrar sin elegir nada.
   *
   * Si no hubiera ninguno marcado —solo pasaría con la base a medio configurar—
   * se cae al más reciente en vez de fallar: la portada tiene que servir algo.
   */
  async primary(): Promise<EventView | null> {
    const row =
      (await this.repo.findOne({ where: { isPrimary: true } })) ??
      (await this.repo.findOne({ where: {}, order: { occurredAt: 'DESC' } }));

    return row ? toView(row) : null;
  }

  /**
   * Id del evento al que se atribuye lo que llega sin especificar.
   *
   * Se consulta cada vez en vez de cachearse: es una lectura indexada de una
   * fila y no está en ningún camino caliente, mientras que una caché obligaría
   * a reiniciar el servicio al cambiar de emergencia — justo el día en que
   * nadie quiere reiniciar nada.
   */
  async primaryId(): Promise<string> {
    const row =
      (await this.repo.findOne({ where: { isPrimary: true }, select: ['id'] })) ??
      (await this.repo.findOne({ where: {}, order: { occurredAt: 'DESC' }, select: ['id'] }));

    if (!row) {
      throw new NotFoundException(
        'No hay ninguna emergencia configurada. Ejecuta las migraciones.',
      );
    }
    return row.id;
  }

  /** Id a partir del slug, para acotar consultas por evento. */
  async idFor(slug?: string | null): Promise<string> {
    if (!slug) return this.primaryId();
    const row = await this.repo.findOne({ where: { slug }, select: ['id'] });
    if (!row) throw new NotFoundException('No se cubre ninguna emergencia con ese identificador.');
    return row.id;
  }

  /** Cifras oficiales del evento, si ya hay balance publicado. */
  async officialFor(slug: string): Promise<ReturnType<typeof officialFiguresFor>> {
    await this.bySlug(slug); // 404 si no existe, antes de mirar el código
    return officialFiguresFor(slug);
  }
}

function toView(row: EventEntity): EventView {
  const punto = fromGeoPoint(row.epicenter);

  return {
    slug: row.slug,
    nombre: row.name,
    tipo: row.kind,
    ocurrioEl: row.occurredAt,
    estado: row.status,
    principal: row.isPrimary,
    epicentro: punto ? { latitud: punto.latitude, longitud: punto.longitude } : null,
    radioKm: row.searchRadiusKm,
    departamentos: row.departments,
    tieneCifrasOficiales: officialFiguresFor(row.slug) !== null,
  };
}
