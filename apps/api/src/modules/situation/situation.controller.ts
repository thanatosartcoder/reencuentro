import { Controller, Get, Query } from '@nestjs/common';
import { PersonsService } from 'src/modules/persons/persons.service';
import { GeoService } from 'src/modules/geo/geo.service';
import { AFFECTED_CAPITALS, EPICENTER_TOWN, EVENT, IMPACT } from './situation.data';
import { officialFiguresFor } from './situation.data';
import { EventsService } from 'src/modules/events/events.service';

@Controller('situacion')
export class SituationController {
  constructor(
    private readonly persons: PersonsService,
    private readonly geo: GeoService,
    private readonly events: EventsService,
  ) {}

  /**
   * Tablero de situación.
   *
   * Separa a propósito dos cosas que no deben mezclarse: las cifras oficiales
   * de la UNGRD y la Fiscalía, con su fecha de corte y su fuente, y lo que ha
   * pasado dentro de esta plataforma. Presentar los reportes propios junto a
   * los oficiales sin distinguirlos daría a unos la autoridad de los otros.
   */
  @Get()
  async overview(@Query('evento') slug?: string) {
    // Sin parámetro, la emergencia en curso. Con él, se consulta una anterior
    // sin cambiar cuál está activa.
    const evento = slug ? await this.events.bySlug(slug) : await this.events.primary();

    const [platform, zones] = await Promise.all([
      this.persons.getStats(),
      this.geo.summaryByDepartment(slug),
    ]);

    // Las cifras oficiales son las de la emergencia en curso. Una recién
    // declarada todavía no tiene balance publicado, y entonces se dice — no se
    // muestran ceros, que se leerían como "aquí no pasó nada".
    const oficiales = evento ? officialFiguresFor(evento.slug) : null;

    return {
      emergencia: evento && {
        slug: evento.slug,
        nombre: evento.nombre,
        tipo: evento.tipo,
        ocurrioEl: evento.ocurrioEl,
        departamentos: evento.departamentos,
        // Con esto la web sabe si está en modo consulta: se puede mirar una
        // emergencia anterior, pero no reportar sobre ella.
        enCurso: evento.principal,
        estado: evento.estado,
      },
      evento: oficiales?.event ?? null,
      epicentro: oficiales?.epicenterTown ?? null,
      cifrasOficiales: oficiales && {
        ...oficiales.impact,
        aviso:
          'Cifras oficiales de la UNGRD y la Fiscalía General de la Nación. ' +
          'No provienen de esta plataforma.',
      },
      capitalesAfectadas: oficiales?.capitals ?? [],
      plataforma: {
        ...platform,
        aviso: 'Reportes registrados en esta plataforma. No son cifras oficiales.',
      },
      zonasPorDepartamento: zones,
    };
  }

  /** Solo las cifras oficiales, para widgets y consumidores externos. */
  @Get('oficial')
  async official() {
    const evento = await this.events.primary();
    const oficiales = evento ? officialFiguresFor(evento.slug) : null;
    if (!oficiales) return null;
    return {
      evento: oficiales.event,
      impacto: oficiales.impact,
      capitales: oficiales.capitals,
    };
  }
}
