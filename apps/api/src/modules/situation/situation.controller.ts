import { Controller, Get } from '@nestjs/common';
import { PersonsService } from 'src/modules/persons/persons.service';
import { GeoService } from 'src/modules/geo/geo.service';
import { AFFECTED_CAPITALS, EPICENTER_TOWN, EVENT, IMPACT } from './situation.data';

@Controller('situacion')
export class SituationController {
  constructor(
    private readonly persons: PersonsService,
    private readonly geo: GeoService,
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
  async overview() {
    const [platform, zones] = await Promise.all([
      this.persons.getStats(),
      this.geo.summaryByDepartment(),
    ]);

    return {
      evento: EVENT,
      epicentro: EPICENTER_TOWN,
      cifrasOficiales: {
        ...IMPACT,
        aviso:
          'Cifras oficiales de la UNGRD y la Fiscalía General de la Nación. ' +
          'No provienen de esta plataforma.',
      },
      capitalesAfectadas: AFFECTED_CAPITALS,
      plataforma: {
        ...platform,
        aviso: 'Reportes registrados en esta plataforma. No son cifras oficiales.',
      },
      zonasPorDepartamento: zones,
    };
  }

  /** Solo las cifras oficiales, para widgets y consumidores externos. */
  @Get('oficial')
  official() {
    return { evento: EVENT, impacto: IMPACT, capitales: AFFECTED_CAPITALS };
  }
}
