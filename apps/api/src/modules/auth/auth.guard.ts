import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService, OperatorClaims } from './auth.service';
import { OperatorRole } from './entities/operator.entity';

export const ROLES_KEY = 'roles';

/** Restringe un endpoint a ciertos roles del panel de validación. */
export const Roles = (...roles: OperatorRole[]) => SetMetadata(ROLES_KEY, roles);

/** Inyecta el operador autenticado en el handler. */
export const CurrentOperator = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OperatorClaims => {
    const request = ctx.switchToHttp().getRequest<Request & { operator?: OperatorClaims }>();
    if (!request.operator) throw new UnauthorizedException('No autenticado');
    return request.operator;
  },
);

@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { operator?: OperatorClaims }>();

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Falta el token de acceso');
    }

    const claims = await this.auth.verify(header.slice(7));
    request.operator = claims;

    const required = this.reflector.getAllAndOverride<OperatorRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // ADMIN pasa siempre: en una emergencia no puede haber una acción bloqueada
    // porque nadie previó qué rol la necesitaba.
    if (required?.length && claims.role !== OperatorRole.ADMIN && !required.includes(claims.role)) {
      throw new ForbiddenException('Tu rol no tiene permiso para esta acción');
    }

    return true;
  }
}
