import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { generateClaimToken, hashToken } from 'src/common/crypto/tokens';
import { Operator, OperatorRole } from './entities/operator.entity';
import { validatePassword } from './password';
import {
  MAX_INVITATION_ATTEMPTS,
  codeMatches,
  formatCode,
  generateVerificationCode,
  hashCode,
} from './invitation-code';

/**
 * Alta y gestión de personal acreditado.
 *
 * Existe porque la revisión humana es la puerta por la que pasa cada aviso a
 * una familia, y hasta ahora esa puerta solo la podían atender las dos cuentas
 * que creaba la instalación. Con cientos de desaparecidos eso no es una
 * incomodidad administrativa: es tiempo que una familia espera de más.
 *
 * Quien invita no elige la contraseña de nadie. Envía un enlace y la persona
 * establece la suya. Si dos personas conocen una credencial, la bitácora deja
 * de poder responder quién accedió a los datos de un menor — que es justo lo
 * que la Ley 1581 obliga a poder demostrar.
 *
 * La invitación va partida en dos piezas que viajan por canales distintos: el
 * enlace y un código corto. Un enlace suelto es una credencial completa —se
 * reenvía, se filtra en una captura, queda en el historial de un grupo— y
 * quien lo tuviera entraría a ver el documento y el teléfono de familias que
 * reportaron a un desaparecido. Con la credencial partida, reenviar el chat ya
 * no alcanza.
 */

/** Días que dura un enlace de invitación sin usar. */
const INVITATION_DAYS = 7;

const BCRYPT_ROUNDS = 12;

/**
 * Qué rol puede crear qué rol.
 *
 * Un coordinador puede sumar validadores —es lo que hace falta para escalar la
 * revisión— pero no puede fabricarse un par ni ascender a nadie por encima de
 * sí mismo. Sin esta regla, invitar es una vía silenciosa a la escalada de
 * privilegios.
 */
const CAN_CREATE: Record<OperatorRole, OperatorRole[]> = {
  [OperatorRole.ADMIN]: [
    OperatorRole.ADMIN,
    OperatorRole.COORDINATOR,
    OperatorRole.VALIDATOR,
    OperatorRole.VIEWER,
  ],
  [OperatorRole.COORDINATOR]: [OperatorRole.VALIDATOR, OperatorRole.VIEWER],
  [OperatorRole.VALIDATOR]: [],
  [OperatorRole.VIEWER]: [],
};

export interface OperatorView {
  id: string;
  email: string;
  fullName: string;
  organization: string | null;
  role: OperatorRole;
  isActive: boolean;
  /** true si aún no ha establecido su contraseña. */
  invitationPending: boolean;
  invitationExpiresAt: Date | null;
  invitedByName: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class OperatorsService {
  constructor(
    @InjectRepository(Operator)
    private readonly repo: Repository<Operator>,
  ) {}

  async list(): Promise<OperatorView[]> {
    const rows = await this.repo.find({ order: { createdAt: 'ASC' } });
    return rows.map((row) => toView(row));
  }

  /**
   * Invita a alguien. Devuelve el token en claro **una sola vez**.
   *
   * No se envía correo: este despliegue no tiene proveedor configurado, y en
   * una emergencia la coordinación ocurre por los canales que ya usa la gente.
   * Quien invita recibe el enlace y lo hace llegar como corresponda.
   */
  async invite(
    input: { email: string; fullName: string; organization?: string; role: OperatorRole },
    invitedBy: { id: string; name: string; role: OperatorRole },
  ): Promise<{
    operator: OperatorView;
    invitationToken: string;
    verificationCode: string;
    expiresAt: Date;
  }> {
    if (!CAN_CREATE[invitedBy.role].includes(input.role)) {
      throw new ForbiddenException(
        `Tu rol no puede crear cuentas con rol ${input.role}.`,
      );
    }

    const email = input.email.trim().toLowerCase();
    const existing = await this.repo.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con ese correo.');
    }

    const token = generateClaimToken();
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + INVITATION_DAYS * 86_400_000);

    const operator = await this.repo.save(
      this.repo.create({
        email,
        fullName: input.fullName.trim(),
        organization: input.organization?.trim() || null,
        role: input.role,
        // Sin contraseña hasta que la persona la establezca: la cuenta existe
        // pero todavía no puede entrar.
        passwordHash: null,
        isActive: true,
        invitationTokenHash: hashToken(token),
        invitationCodeHash: hashCode(code),
        invitationAttempts: 0,
        invitationExpiresAt: expiresAt,
        invitedById: invitedBy.id,
        invitedByName: invitedBy.name,
        invitedAt: new Date(),
      }),
    );

    return {
      operator: toView(operator),
      invitationToken: token,
      verificationCode: formatCode(code),
      expiresAt,
    };
  }

  /** Vuelve a emitir enlace y código. Los anteriores dejan de servir. */
  async reinvite(
    operatorId: string,
    invitedBy: { id: string; name: string; role: OperatorRole },
  ): Promise<{ invitationToken: string; verificationCode: string; expiresAt: Date }> {
    const operator = await this.repo.findOne({ where: { id: operatorId } });
    if (!operator) throw new NotFoundException('Cuenta no encontrada');

    if (!CAN_CREATE[invitedBy.role].includes(operator.role)) {
      throw new ForbiddenException('Tu rol no puede gestionar esta cuenta.');
    }

    const token = generateClaimToken();
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + INVITATION_DAYS * 86_400_000);

    await this.repo.update(operator.id, {
      invitationTokenHash: hashToken(token),
      invitationCodeHash: hashCode(code),
      // El contador vuelve a cero: la invitación anterior ya no existe.
      invitationAttempts: 0,
      invitationExpiresAt: expiresAt,
      invitedById: invitedBy.id,
      invitedByName: invitedBy.name,
      invitedAt: new Date(),
      // Reinvitar anula la contraseña anterior: es también la vía para alguien
      // que perdió la suya y no puede recuperarla por su cuenta.
      passwordHash: null,
    });

    return { invitationToken: token, verificationCode: formatCode(code), expiresAt };
  }

  /**
   * Muestra a quién pertenece un enlace, sin revelar nada aprovechable.
   *
   * Devuelve solo el nombre y la organización para que la persona confirme que
   * el enlace es suyo antes de teclear un código. No devuelve el correo: si el
   * enlace acabó en manos ajenas, no tiene por qué entregar además una
   * dirección válida contra la cual dirigir un intento de suplantación.
   */
  async describeInvitation(
    token: string,
  ): Promise<{ fullName: string; organization: string | null; role: OperatorRole }> {
    const operator = await this.repo
      .createQueryBuilder('o')
      .addSelect('o.invitationTokenHash')
      .where('o."invitationTokenHash" = :hash', { hash: hashToken(token) })
      .getOne();

    if (
      !operator ||
      !operator.isActive ||
      !operator.invitationExpiresAt ||
      operator.invitationExpiresAt < new Date()
    ) {
      throw new BadRequestException(
        'El enlace no es válido o ya caducó. Pide a quien te invitó que genere uno nuevo.',
      );
    }

    return {
      fullName: operator.fullName,
      organization: operator.organization,
      role: operator.role,
    };
  }

  /**
   * Acepta una invitación: enlace + código + contraseña.
   *
   * Es público a propósito —quien la acepta todavía no tiene sesión— y por eso
   * exige las dos mitades de la credencial. El enlace prueba que llegó por el
   * canal escrito; el código, que la persona estuvo también en la llamada.
   *
   * Los errores no distinguen entre "código incorrecto" y "enlace desconocido":
   * quien tenga solo una mitad no debe poder averiguar si la otra existe.
   */
  async acceptInvitation(
    token: string,
    code: string,
    password: string,
  ): Promise<{ email: string; fullName: string }> {
    const invalido = new BadRequestException(
      'El enlace o el código no son correctos.',
    );

    const operator = await this.repo
      .createQueryBuilder('o')
      .addSelect(['o.invitationTokenHash', 'o.invitationCodeHash', 'o.passwordHash'])
      .where('o."invitationTokenHash" = :hash', { hash: hashToken(token) })
      .getOne();

    if (!operator || !operator.invitationCodeHash) throw invalido;
    if (!operator.isActive) {
      throw new BadRequestException('Esta cuenta está desactivada.');
    }
    if (!operator.invitationExpiresAt || operator.invitationExpiresAt < new Date()) {
      throw new BadRequestException(
        'El enlace caducó. Pide a quien te invitó que genere uno nuevo.',
      );
    }
    if (operator.invitationAttempts >= MAX_INVITATION_ATTEMPTS) {
      throw new BadRequestException(
        'Se agotaron los intentos. Pide a quien te invitó que genere una invitación nueva.',
      );
    }

    if (!codeMatches(code, operator.invitationCodeHash)) {
      // El contador sube antes de responder. Si el proceso muriera aquí, el
      // intento igual quedó contado.
      await this.repo.increment({ id: operator.id }, 'invitationAttempts', 1);

      const restantes = MAX_INVITATION_ATTEMPTS - operator.invitationAttempts - 1;
      throw new BadRequestException(
        restantes > 0
          ? `El enlace o el código no son correctos. Te quedan ${restantes} intento${restantes === 1 ? '' : 's'}.`
          : 'Se agotaron los intentos. Pide a quien te invitó que genere una invitación nueva.',
      );
    }

    // La contraseña se valida después del código: así un enlace robado sin
    // código no obtiene ni siquiera las reglas de contraseña como señal de que
    // acertó la primera mitad.
    const check = validatePassword(password, operator.email);
    if (!check.ok) throw new BadRequestException(check.reason);

    await this.repo.update(operator.id, {
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      // Ambas mitades se consumen: una invitación reutilizable en el historial
      // de un chat es una credencial permanente.
      invitationTokenHash: null,
      invitationCodeHash: null,
      invitationExpiresAt: null,
      invitationAttempts: 0,
    });

    return { email: operator.email, fullName: operator.fullName };
  }

  /**
   * Desactiva una cuenta. No se borra.
   *
   * Sus decisiones de validación siguen en la bitácora, y esa bitácora tiene
   * que poder responder quién confirmó una coincidencia aunque esa persona ya
   * no trabaje aquí.
   */
  async setActive(
    operatorId: string,
    isActive: boolean,
    actor: { id: string; role: OperatorRole },
  ): Promise<OperatorView> {
    if (operatorId === actor.id && !isActive) {
      throw new BadRequestException('No puedes desactivar tu propia cuenta.');
    }

    const operator = await this.repo.findOne({ where: { id: operatorId } });
    if (!operator) throw new NotFoundException('Cuenta no encontrada');

    if (
      operator.role === OperatorRole.ADMIN &&
      actor.role !== OperatorRole.ADMIN
    ) {
      throw new ForbiddenException('Solo un administrador puede gestionar a otro.');
    }

    // No puede quedar el sistema sin nadie capaz de validar: sin validadores
    // activos, ninguna familia recibe un aviso nunca más.
    if (!isActive) {
      const quedan = await this.repo.count({
        where: [
          { isActive: true, role: OperatorRole.VALIDATOR, id: Not(operatorId) },
          { isActive: true, role: OperatorRole.COORDINATOR, id: Not(operatorId) },
          { isActive: true, role: OperatorRole.ADMIN, id: Not(operatorId) },
        ],
      });
      if (quedan === 0) {
        throw new BadRequestException(
          'Es la última cuenta capaz de validar coincidencias. Invita a otra persona antes de desactivarla.',
        );
      }
    }

    await this.repo.update(operatorId, { isActive });
    return toView({ ...operator, isActive });
  }
}

function toView(operator: Operator): OperatorView {
  return {
    id: operator.id,
    email: operator.email,
    fullName: operator.fullName,
    organization: operator.organization,
    role: operator.role,
    isActive: operator.isActive,
    invitationPending: operator.passwordHash === null,
    invitationExpiresAt: operator.invitationExpiresAt,
    invitedByName: operator.invitedByName,
    lastLoginAt: operator.lastLoginAt,
    createdAt: operator.createdAt,
  };
}
