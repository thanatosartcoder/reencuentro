import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Operator, OperatorRole } from './entities/operator.entity';
import { isSeedPassword, validatePassword } from './password';

export interface OperatorClaims {
  sub: string;
  name: string;
  role: OperatorRole;
  organization: string | null;
  /**
   * Momento de emisión. Un token emitido antes del último cambio de contraseña
   * deja de valer, que es lo que hace que cambiarla expulse de verdad a quien
   * la tuviera.
   */
  iat?: number;
  /** Si la sesión está limitada hasta que se cambie la contraseña. */
  mustChangePassword?: boolean;
}

/** Coste de bcrypt. 12 es el equilibrio actual entre resistencia y latencia de login. */
const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Operator)
    private readonly repo: Repository<Operator>,
    private readonly jwt: JwtService,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; operator: OperatorClaims; mustChangePassword: boolean }> {
    const operator = await this.repo
      .createQueryBuilder('o')
      // passwordHash tiene select:false en la entidad; se pide explicitamente
      // para que no viaje por accidente en ninguna otra consulta.
      .addSelect('o.passwordHash')
      .where('lower(o.email) = lower(:email)', { email })
      .getOne();

    // Se ejecuta la comparacion incluso sin operador encontrado para que el
    // tiempo de respuesta no revele si el correo existe.
    const hash =
      operator?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvaluO';
    const valid = await bcrypt.compare(password, hash);

    if (!operator || !valid || !operator.isActive) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    await this.repo.update(operator.id, { lastLoginAt: new Date() });

    // Entrar con la contraseña de la instalación fuerza el cambio, aunque
    // nadie haya marcado la cuenta: esa clave está publicada.
    const mustChange = operator.mustChangePassword || isSeedPassword(password);

    const claims: OperatorClaims = {
      sub: operator.id,
      name: operator.fullName,
      role: operator.role,
      organization: operator.organization,
      mustChangePassword: mustChange,
    };

    return {
      accessToken: await this.jwt.signAsync(claims),
      operator: claims,
      mustChangePassword: mustChange,
    };
  }

  /**
   * Cambia la contraseña de quien está autenticado.
   *
   * Exige la actual aunque ya haya sesión válida: si alguien deja la pantalla
   * abierta, un tercero no debería poder apropiarse de la cuenta con dos clics.
   */
  async changePassword(
    operatorId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ accessToken: string }> {
    const operator = await this.repo
      .createQueryBuilder('o')
      .addSelect('o.passwordHash')
      .where('o.id = :id', { id: operatorId })
      .getOne();

    if (!operator) throw new UnauthorizedException('Sesión inválida');

    const valid = await bcrypt.compare(currentPassword, operator.passwordHash);
    if (!valid) {
      throw new BadRequestException('La contraseña actual no es correcta');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException('La contraseña nueva debe ser distinta de la actual');
    }

    const check = validatePassword(newPassword, operator.email);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    const changedAt = new Date();
    await this.repo.update(operator.id, {
      passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
      passwordChangedAt: changedAt,
      mustChangePassword: false,
    });

    // Se emite un token nuevo porque el anterior queda invalidado por fecha:
    // sin esto, quien acaba de cambiar su contraseña se quedaría sin sesión.
    const claims: OperatorClaims = {
      sub: operator.id,
      name: operator.fullName,
      role: operator.role,
      organization: operator.organization,
      mustChangePassword: false,
    };

    return { accessToken: await this.jwt.signAsync(claims) };
  }

  async verify(token: string): Promise<OperatorClaims> {
    let claims: OperatorClaims;
    try {
      claims = await this.jwt.verifyAsync<OperatorClaims>(token);
    } catch {
      throw new UnauthorizedException('Sesión inválida o expirada');
    }

    // Un token emitido antes del último cambio de contraseña ya no vale. Es lo
    // que convierte "cambié la contraseña" en "expulsé a quien la tuviera", en
    // vez de dejar sesiones vivas hasta que caduquen solas.
    const operator = await this.repo.findOne({
      where: { id: claims.sub },
      select: { id: true, isActive: true, passwordChangedAt: true, mustChangePassword: true },
    });

    if (!operator || !operator.isActive) {
      throw new UnauthorizedException('La cuenta ya no está activa');
    }

    // `iat` viene en segundos enteros truncados hacia abajo, así que el token
    // emitido en el mismo instante del cambio aparenta ser anterior por unos
    // milisegundos. Sin este margen, cambiar la contraseña invalidaba también
    // el token recién emitido y expulsaba a quien acababa de hacer lo correcto.
    const CLOCK_GRACE_MS = 2_000;
    if (
      operator.passwordChangedAt &&
      claims.iat &&
      claims.iat * 1000 + CLOCK_GRACE_MS < operator.passwordChangedAt.getTime()
    ) {
      throw new UnauthorizedException('La contraseña cambió. Vuelve a iniciar sesión.');
    }

    // Se combinan las dos señales en vez de dejar que la base pise al token.
    // La marca puede venir del token —porque se entró con la contraseña de la
    // instalación, algo que la base no sabe— o de la cuenta. Sobrescribir una
    // con otra dejaba pasar sesiones que debían estar bloqueadas.
    return {
      ...claims,
      mustChangePassword: Boolean(claims.mustChangePassword || operator.mustChangePassword),
    };
  }
}
