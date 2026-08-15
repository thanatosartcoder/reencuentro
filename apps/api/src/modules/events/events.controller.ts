import { Controller, Get, Param } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { EventsService } from './events.service';

/**
 * Emergencias cubiertas.
 *
 * Público: saber qué eventos cubre la plataforma no revela nada de nadie, y
 * quien llega buscando a una persona tiene que poder ver si su emergencia está
 * aquí antes de escribir un reporte.
 */
@Controller('eventos')
@SkipThrottle()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list() {
    return this.events.list();
  }

  /** El que se muestra al entrar sin elegir nada. */
  @Get('principal')
  primary() {
    return this.events.primary();
  }

  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.events.bySlug(slug);
  }

  /**
   * Cifras oficiales. Devuelve null cuando aún no hay balance publicado — y eso
   * se dice explícitamente en vez de mandar ceros: la ausencia de cifras no es
   * ausencia de daño.
   */
  @Get(':slug/oficial')
  official(@Param('slug') slug: string) {
    return this.events.officialFor(slug);
  }
}
