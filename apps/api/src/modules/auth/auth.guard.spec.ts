import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OperatorGuard, ROLES_KEY, Roles } from './auth.guard';
import { AuthService, OperatorClaims } from './auth.service';
import { OperatorRole } from './entities/operator.entity';

/**
 * El guard decide quién ve datos de personas, así que su comportamiento se
 * comprueba en vez de deducirse.
 *
 * En concreto la regla de composición: con `getAllAndOverride`, un `@Roles` en
 * un método pisaba al de su controlador, de modo que un decorador que se lee
 * como una restricción podía en realidad *ampliar* el acceso. Aquí se fija que
 * un decorador de seguridad solo puede estrechar.
 */

function contextoCon(handlerRoles?: OperatorRole[], classRoles?: OperatorRole[]): ExecutionContext {
  class Controlador {}
  function manejador() {}

  if (handlerRoles) Roles(...handlerRoles)({}, 'manejador', { value: manejador });
  if (classRoles) Roles(...classRoles)(Controlador);

  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: 'Bearer da-igual' } }),
    }),
    getHandler: () => manejador,
    getClass: () => Controlador,
  } as unknown as ExecutionContext;
}

function guardPara(role: OperatorRole): OperatorGuard {
  const claims: OperatorClaims = {
    sub: 'op-1',
    name: 'Quien sea',
    role,
    organization: null,
    mustChangePassword: false,
  };
  const auth = { verify: jest.fn().mockResolvedValue(claims) } as unknown as AuthService;
  return new OperatorGuard(auth, new Reflector());
}

describe('OperatorGuard · composición de roles', () => {
  it('respeta el rol exigido por la clase cuando el método no declara ninguno', async () => {
    await expect(
      guardPara(OperatorRole.VALIDATOR).canActivate(contextoCon(undefined, [OperatorRole.VALIDATOR])),
    ).resolves.toBe(true);

    await expect(
      guardPara(OperatorRole.VIEWER).canActivate(contextoCon(undefined, [OperatorRole.VALIDATOR])),
    ).rejects.toThrow(ForbiddenException);
  });

  it('un @Roles en el método no puede ampliar lo que la clase restringe', async () => {
    // El caso que motivó el cambio: la clase exige VALIDATOR y el método
    // menciona VIEWER. Antes, el del método ganaba y VIEWER entraba.
    const contexto = contextoCon([OperatorRole.VIEWER], [OperatorRole.VALIDATOR]);
    await expect(guardPara(OperatorRole.VIEWER).canActivate(contexto)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('sí puede estrechar: hay que cumplir las dos declaraciones', async () => {
    const contexto = () => contextoCon([OperatorRole.COORDINATOR], [OperatorRole.VALIDATOR, OperatorRole.COORDINATOR]);

    await expect(guardPara(OperatorRole.COORDINATOR).canActivate(contexto())).resolves.toBe(true);
    // VALIDATOR cumple la clase pero no el método.
    await expect(guardPara(OperatorRole.VALIDATOR).canActivate(contexto())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('ADMIN sigue pasando siempre', async () => {
    await expect(
      guardPara(OperatorRole.ADMIN).canActivate(contextoCon([OperatorRole.VIEWER], [OperatorRole.VALIDATOR])),
    ).resolves.toBe(true);
  });

  it('sin ninguna declaración basta con estar autenticado', async () => {
    await expect(guardPara(OperatorRole.VIEWER).canActivate(contextoCon())).resolves.toBe(true);
  });
});

describe('OperatorGuard · metadatos', () => {
  it('Roles guarda la lista bajo la clave que lee el guard', () => {
    class C {}
    Roles(OperatorRole.VALIDATOR)(C);
    expect(new Reflector().get(ROLES_KEY, C)).toEqual([OperatorRole.VALIDATOR]);
  });
});
