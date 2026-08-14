import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Operator, OperatorRole } from './entities/operator.entity';

export interface OperatorClaims {
  sub: string;
  name: string;
  role: OperatorRole;
  organization: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Operator)
    private readonly repo: Repository<Operator>,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<{ accessToken: string; operator: OperatorClaims }> {
    const operator = await this.repo
      .createQueryBuilder('o')
      // passwordHash tiene select:false en la entidad; se pide explicitamente
      // para que no viaje por accidente en ninguna otra consulta.
      .addSelect('o.passwordHash')
      .where('lower(o.email) = lower(:email)', { email })
      .getOne();

    // Se ejecuta la comparacion incluso sin operador encontrado para que el
    // tiempo de respuesta no revele si el correo existe.
    const hash = operator?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvaliduO';
    const valid = await bcrypt.compare(password, hash);

    if (!operator || !valid || !operator.isActive) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    await this.repo.update(operator.id, { lastLoginAt: new Date() });

    const claims: OperatorClaims = {
      sub: operator.id,
      name: operator.fullName,
      role: operator.role,
      organization: operator.organization,
    };

    return { accessToken: await this.jwt.signAsync(claims), operator: claims };
  }

  async verify(token: string): Promise<OperatorClaims> {
    try {
      return await this.jwt.verifyAsync<OperatorClaims>(token);
    } catch {
      throw new UnauthorizedException('Sesión inválida o expirada');
    }
  }
}
