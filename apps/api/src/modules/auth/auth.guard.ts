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
export const ALLOW_PENDING_PASSWORD_KEY = 'allowPendingPassword';

/**
 * Marca los endpoints accesibles con una sesión que aún debe cambiar la
 * contraseña. Solo el propio cambio y la consulta de la sesión lo llevan.
 */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);

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

    // Una cuenta con la contraseña de la instalación no puede ver datos de
    // personas: esa clave está publicada en el repositorio. La sesión existe,
    // pero solo sirve para cambiarla.
    if (claims.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean | undefined>(
        ALLOW_PENDING_PASSWORD_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed) {
        throw new ForbiddenException(
          'Debes cambiar tu contraseña antes de poder usar el panel.',
        );
      }
    }

    // Se recogen las dos declaraciones —la del método y la de la clase— y hay
    // que satisfacer ambas, en lugar de dejar que la del método pise a la de la
    // clase.
    //
    // Con `getAllAndOverride`, un `@Roles` puesto en un handler *ampliaba* el
    // acceso por debajo del mínimo que fijaba su controlador, y el código
    // resultante no lo delata: se lee como una restricción cuando en realidad
    // es un permiso. Un decorador de seguridad solo debería poder estrechar.
    const declared = this.reflector
      .getAll<(OperatorRole[] | undefined)[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
      .filter((roles): roles is OperatorRole[] => Boolean(roles?.length));

    // ADMIN pasa siempre: en una emergencia no puede haber una acción bloqueada
    // porque nadie previó qué rol la necesitaba.
    if (
      claims.role !== OperatorRole.ADMIN &&
      declared.some((required) => !required.includes(claims.role))
    ) {
      throw new ForbiddenException('Tu rol no tiene permiso para esta acción');
    }

    return true;
  }
}
