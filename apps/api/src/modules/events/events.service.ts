import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { fromGeoPoint } from 'src/common/geo/geo.util';
import { officialFiguresFor } from 'src/modules/situation/situation.data';
import { EventEntity, EventKind, EventStatus } from './entities/event.entity';
import { toGeoPoint } from 'src/common/geo/geo.util';

/**
 * Consulta de emergencias cubiertas.
 *
 * El evento es una fila para poder cubrir la siguiente sin desplegar una copia
 * de la plataforma. Sus cifras oficiales siguen viviendo en código: aquí solo
 * se juntan al servirlas.
 */

export interface EventView {
  /** Necesario para atar lo que se escribe durante el evento. */
  id: string;
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
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // --- Gestión ---

  /**
   * Declara una emergencia nueva.
   *
   * No la activa: crear y activar son dos decisiones distintas. Se puede
   * preparar una emergencia —con su epicentro, su radio, sus departamentos— y
   * revisarla antes de que el sitio entero empiece a mostrarla.
   */
  async create(input: {
    slug: string;
    name: string;
    kind: EventKind;
    occurredAt: Date;
    epicenter?: { latitude: number; longitude: number } | null;
    searchRadiusKm?: number | null;
    departments?: string[];
  }): Promise<EventView> {
    const slug = normalizeSlug(input.slug);

    if (await this.repo.findOne({ where: { slug } })) {
      throw new ConflictException('Ya existe una emergencia con ese identificador.');
    }

    const row = await this.repo.save(
      this.repo.create({
        slug,
        name: input.name.trim(),
        kind: input.kind,
        occurredAt: input.occurredAt,
        epicenter: input.epicenter
          ? toGeoPoint(input.epicenter.latitude, input.epicenter.longitude)
          : null,
        searchRadiusKm: input.searchRadiusKm ?? null,
        departments: input.departments ?? [],
        status: EventStatus.ACTIVE,
        isPrimary: false,
      }),
    );

    return toView(row);
  }

  /**
   * Edita una emergencia.
   *
   * El `slug` no se puede cambiar. Es lo que enlaza la fila con sus cifras
   * oficiales en código y con sus datasets, y además viaja en enlaces que la
   * gente comparte por WhatsApp durante una emergencia y siguen circulando
   * meses después. Renombrarlo rompería las tres cosas a la vez.
   */
  async update(
    slug: string,
    input: {
      name?: string;
      kind?: EventKind;
      occurredAt?: Date;
      epicenter?: { latitude: number; longitude: number } | null;
      searchRadiusKm?: number | null;
      departments?: string[];
      status?: EventStatus;
    },
  ): Promise<EventView> {
    const row = await this.repo.findOne({ where: { slug } });
    if (!row) throw new NotFoundException('No se cubre ninguna emergencia con ese identificador.');

    if (input.status === EventStatus.CLOSED && row.isPrimary) {
      throw new BadRequestException(
        'No se puede cerrar la emergencia activa. Activa otra primero.',
      );
    }

    await this.repo.update(row.id, {
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.kind !== undefined && { kind: input.kind }),
      ...(input.occurredAt !== undefined && { occurredAt: input.occurredAt }),
      ...(input.epicenter !== undefined && {
        epicenter: input.epicenter
          ? toGeoPoint(input.epicenter.latitude, input.epicenter.longitude)
          : null,
      }),
      ...(input.searchRadiusKm !== undefined && { searchRadiusKm: input.searchRadiusKm }),
      ...(input.departments !== undefined && { departments: input.departments }),
      ...(input.status !== undefined && { status: input.status }),
    });

    return this.bySlug(slug);
  }

  /**
   * Convierte una emergencia en la que muestra el sitio.
   *
   * En una transacción y desmarcando primero. La base tiene un índice parcial
   * único sobre `isPrimary`, así que marcar antes de desmarcar fallaría — y sin
   * transacción, un fallo entre las dos operaciones dejaría el sitio sin
   * ninguna emergencia activa.
   *
   * Es la acción más consecuente del panel: cambia lo que ve todo el que entre.
   */
  async makePrimary(slug: string): Promise<EventView> {
    const row = await this.repo.findOne({ where: { slug } });
    if (!row) throw new NotFoundException('No se cubre ninguna emergencia con ese identificador.');

    if (row.status === EventStatus.CLOSED) {
      throw new BadRequestException(
        'Esa emergencia está cerrada. Reábrela antes de activarla.',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(EventEntity, { isPrimary: true, id: Not(row.id) }, { isPrimary: false });
      await manager.update(EventEntity, row.id, { isPrimary: true });
    });

    return this.bySlug(slug);
  }

  /**
   * Cuántos datos cuelgan de una emergencia.
   *
   * Se consulta antes de ofrecer borrarla: la clave foránea es RESTRICT, así
   * que el borrado fallaría igual, pero decirlo antes es mejor que dejar que la
   * base lo rechace con un mensaje que nadie entiende.
   */
  async dataCounts(slug: string): Promise<Record<string, number>> {
    const row = await this.repo.findOne({ where: { slug } });
    if (!row) throw new NotFoundException('No se cubre ninguna emergencia con ese identificador.');

    const [counts] = await this.dataSource.query<[Record<string, string>]>(
      `SELECT
         (SELECT count(*) FROM zone_reports WHERE "eventId" = $1) AS zonas,
         (SELECT count(*) FROM damage_assessments WHERE "eventId" = $1) AS danos,
         (SELECT count(*) FROM damage_coverage WHERE "eventId" = $1) AS cobertura,
         (SELECT count(*) FROM seismic_events WHERE "eventId" = $1) AS sismos`,
      [row.id],
    );

    return Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, Number(v)]),
    );
  }

  /**
   * Borra una emergencia que nunca llegó a usarse.
   *
   * Solo si no cuelga nada de ella. Una emergencia con reportes de la comunidad
   * no se borra: se cierra. Ese historial es de quien lo reportó, no de quien
   * administra la plataforma.
   */
  async remove(slug: string): Promise<void> {
    const row = await this.repo.findOne({ where: { slug } });
    if (!row) throw new NotFoundException('No se cubre ninguna emergencia con ese identificador.');

    if (row.isPrimary) {
      throw new BadRequestException('No se puede borrar la emergencia activa.');
    }

    const counts = await this.dataCounts(slug);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total > 0) {
      throw new BadRequestException(
        `Esta emergencia tiene ${total} registro(s) asociados. Ciérrala en vez de borrarla: ` +
          'ese historial es de quien lo reportó.',
      );
    }

    await this.repo.delete(row.id);
  }


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
    id: row.id,
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

/**
 * Normaliza el identificador legible.
 *
 * Se hace aquí y no se confía en quien lo escribe: aparece en URLs que la gente
 * comparte durante una emergencia, y un espacio o una tilde lo convierten en un
 * enlace que unos clientes escapan y otros no.
 */
function normalizeSlug(raw: string): string {
  const slug = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length < 3) {
    throw new BadRequestException('El identificador es demasiado corto.');
  }
  return slug;
}
