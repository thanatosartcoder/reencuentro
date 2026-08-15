import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AuditService } from 'src/modules/audit/audit.service';
import { CurrentOperator, OperatorGuard, Roles } from './auth.guard';
import { OperatorClaims } from './auth.service';
import { OperatorRole } from './entities/operator.entity';
import { OperatorsService } from './operators.service';

class InviteDto {
  @IsEmail({}, { message: 'El correo no es válido' })
  @MaxLength(200)
  email: string;

  @IsString()
  @MinLength(3, { message: 'El nombre es demasiado corto' })
  @MaxLength(200)
  fullName: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  organization?: string;

  @IsEnum(OperatorRole, { message: 'Rol no reconocido' })
  role: OperatorRole;
}

class AcceptDto {
  @IsString()
  @Length(16, 128)
  token: string;

  /** Con guion o sin él, en cualquier caja: el servicio lo normaliza. */
  @IsString()
  @Length(6, 12, { message: 'El código tiene seis caracteres' })
  code: string;

  @IsString()
  @MaxLength(200)
  password: string;
}

/**
 * Alta de personal acreditado.
 *
 * Hasta ahora las únicas cuentas capaces de validar eran las dos que creaba la
 * instalación, y sumar una tercera exigía SQL a mano. Como la revisión humana
 * es la puerta por la que pasa cada aviso a una familia, ese cuello de botella
 * se medía en tiempo de espera de gente buscando a alguien.
 */
@Controller('operadores')
export class OperatorsController {
  constructor(
    private readonly operators: OperatorsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @UseGuards(OperatorGuard)
  @Roles(OperatorRole.COORDINATOR)
  list() {
    return this.operators.list();
  }

  /**
   * Invita a alguien. Devuelve el enlace y el código **una sola vez**.
   *
   * Las dos piezas se muestran para que quien invita las mande por canales
   * distintos: el enlace por escrito, el código por voz. No se guardan en claro
   * — si se pierden, se emite una invitación nueva.
   */
  @Post()
  @HttpCode(201)
  @UseGuards(OperatorGuard)
  @Roles(OperatorRole.COORDINATOR)
  async invite(@Body() dto: InviteDto, @CurrentOperator() actor: OperatorClaims) {
    const result = await this.operators.invite(dto, {
      id: actor.sub,
      name: actor.name,
      role: actor.role,
    });

    await this.audit.record({
      actorId: actor.sub,
      actorName: actor.name,
      action: 'INVITE_OPERATOR',
      entityType: 'Operator',
      entityId: result.operator.id,
      // Ni el token ni el código entran en la bitácora: quedarían en claro y
      // durante siete días serían una credencial viva para quien la consulte.
      metadata: { email: dto.email, role: dto.role },
    });

    return result;
  }

  /** Emite una invitación nueva. Sirve también para quien perdió su contraseña. */
  @Post(':id/reinvitar')
  @HttpCode(200)
  @UseGuards(OperatorGuard)
  @Roles(OperatorRole.COORDINATOR)
  async reinvite(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOperator() actor: OperatorClaims,
  ) {
    const result = await this.operators.reinvite(id, {
      id: actor.sub,
      name: actor.name,
      role: actor.role,
    });

    await this.audit.record({
      actorId: actor.sub,
      actorName: actor.name,
      action: 'REINVITE_OPERATOR',
      entityType: 'Operator',
      entityId: id,
    });

    return result;
  }

  @Post(':id/estado')
  @HttpCode(200)
  @UseGuards(OperatorGuard)
  @Roles(OperatorRole.COORDINATOR)
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('activo') activo: boolean,
    @CurrentOperator() actor: OperatorClaims,
  ) {
    const view = await this.operators.setActive(id, Boolean(activo), {
      id: actor.sub,
      role: actor.role,
    });

    await this.audit.record({
      actorId: actor.sub,
      actorName: actor.name,
      action: activo ? 'ACTIVATE_OPERATOR' : 'DEACTIVATE_OPERATOR',
      entityType: 'Operator',
      entityId: id,
    });

    return view;
  }

  // --- Público: quien acepta todavía no tiene sesión ---

  /**
   * Confirma a quién pertenece el enlace, antes de pedir el código.
   *
   * Limitado con dureza: es el único punto donde un token se puede probar sin
   * conocer el código.
   */
  @Get('invitacion')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  describe(@Query('token') token: string) {
    return this.operators.describeInvitation(token ?? '');
  }

  /**
   * Acepta la invitación estableciendo la contraseña.
   *
   * El límite por IP cubre lo que el contador por invitación no puede: alguien
   * con muchos enlaces probando un código en cada uno.
   */
  @Post('invitacion')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  async accept(@Body() dto: AcceptDto) {
    const operator = await this.operators.acceptInvitation(
      dto.token,
      dto.code,
      dto.password,
    );

    await this.audit.record({
      actorId: null,
      actorName: operator.fullName,
      action: 'ACCEPT_INVITATION',
      entityType: 'Operator',
      metadata: { email: operator.email },
    });

    return {
      ok: true,
      email: operator.email,
      mensaje: 'Cuenta activada. Ya puedes iniciar sesión.',
    };
  }
}
