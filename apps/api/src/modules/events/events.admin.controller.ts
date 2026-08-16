import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CurrentOperator, OperatorGuard, Roles } from 'src/modules/auth/auth.guard';
import { OperatorClaims } from 'src/modules/auth/auth.service';
import { OperatorRole } from 'src/modules/auth/entities/operator.entity';
import { AuditService } from 'src/modules/audit/audit.service';
import { EventKind, EventStatus } from './entities/event.entity';
import { EventsService } from './events.service';

class EpicenterDto {
  @IsLatitude({ message: 'La latitud no es válida' })
  latitude: number;

  @IsLongitude({ message: 'La longitud no es válida' })
  longitude: number;
}

class CreateEventDto {
  @IsString()
  @Length(3, 120)
  slug: string;

  @IsString()
  @Length(3, 200)
  name: string;

  @IsEnum(EventKind, { message: 'Tipo de emergencia no reconocido' })
  kind: EventKind;

  @IsDateString({}, { message: 'La fecha no es válida' })
  occurredAt: string;

  /** Nulo para lo que no tiene un punto de origen: una inundación, una sequía. */
  @IsOptional()
  @ValidateNested()
  @Type(() => EpicenterDto)
  epicenter?: EpicenterDto | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  searchRadiusKm?: number | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(33, { message: 'Colombia tiene 32 departamentos y un distrito capital' })
  departments?: string[];
}

class UpdateEventDto {
  @IsOptional()
  @IsString()
  @Length(3, 200)
  name?: string;

  @IsOptional()
  @IsEnum(EventKind)
  kind?: EventKind;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => EpicenterDto)
  epicenter?: EpicenterDto | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  searchRadiusKm?: number | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(33)
  departments?: string[];

  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;
}

/**
 * Alta y gestión de emergencias.
 *
 * Hasta ahora declarar una exigía escribir SQL contra la base de producción.
 * Eso no es sostenible para algo que ocurre justo cuando nadie tiene tiempo:
 * una emergencia empieza de madrugada y la plataforma tiene que poder cubrirla
 * esa misma mañana.
 *
 * Todo queda en la bitácora. Activar una emergencia cambia lo que ve cualquiera
 * que entre al sitio, y es la acción más consecuente del panel.
 */
@Controller('admin/eventos')
@UseGuards(OperatorGuard)
@Roles(OperatorRole.COORDINATOR)
export class EventsAdminController {
  constructor(
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  /** Cuántos datos cuelgan de cada emergencia, para decidir si se puede borrar. */
  @Get(':slug/datos')
  counts(@Param('slug') slug: string) {
    return this.events.dataCounts(slug);
  }

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateEventDto, @CurrentOperator() actor: OperatorClaims) {
    const evento = await this.events.create({
      slug: dto.slug,
      name: dto.name,
      kind: dto.kind,
      occurredAt: new Date(dto.occurredAt),
      epicenter: dto.epicenter ?? null,
      searchRadiusKm: dto.searchRadiusKm ?? null,
      departments: dto.departments ?? [],
    });

    await this.audit.record({
      actorId: actor.sub,
      actorName: actor.name,
      action: 'CREATE_EVENT',
      entityType: 'Event',
      entityId: evento.id,
      metadata: { slug: evento.slug, nombre: evento.nombre, tipo: evento.tipo },
    });

    return evento;
  }

  @Patch(':slug')
  async update(
    @Param('slug') slug: string,
    @Body() dto: UpdateEventDto,
    @CurrentOperator() actor: OperatorClaims,
  ) {
    const evento = await this.events.update(slug, {
      ...dto,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
    });

    await this.audit.record({
      actorId: actor.sub,
      actorName: actor.name,
      action: 'UPDATE_EVENT',
      entityType: 'Event',
      entityId: evento.id,
      metadata: { slug, cambios: Object.keys(dto) },
    });

    return evento;
  }

  /**
   * Activa una emergencia: pasa a ser la que muestra todo el sitio.
   *
   * Se registra aparte de una edición normal porque no lo es. Cambia la portada,
   * el mapa, las ingestas y lo que se le atribuye a cada reporte nuevo.
   */
  @Post(':slug/activar')
  @HttpCode(200)
  async activate(@Param('slug') slug: string, @CurrentOperator() actor: OperatorClaims) {
    const anterior = await this.events.primary();
    const evento = await this.events.makePrimary(slug);

    await this.audit.record({
      actorId: actor.sub,
      actorName: actor.name,
      action: 'ACTIVATE_EVENT',
      entityType: 'Event',
      entityId: evento.id,
      metadata: { activada: evento.slug, anterior: anterior?.slug ?? null },
    });

    return evento;
  }

  /**
   * Borra una emergencia que nunca llegó a usarse.
   *
   * El servicio lo rechaza si cuelga cualquier dato: una emergencia con
   * reportes de la comunidad se cierra, no se borra. Ese historial es de quien
   * lo reportó.
   */
  @Delete(':slug')
  @HttpCode(200)
  async remove(@Param('slug') slug: string, @CurrentOperator() actor: OperatorClaims) {
    await this.events.remove(slug);

    await this.audit.record({
      actorId: actor.sub,
      actorName: actor.name,
      action: 'DELETE_EVENT',
      entityType: 'Event',
      metadata: { slug },
    });

    return { ok: true };
  }
}
