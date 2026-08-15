import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuthService, OperatorClaims } from './auth.service';
import { AllowPendingPassword, CurrentOperator, OperatorGuard } from './auth.guard';
import { AuditService } from 'src/modules/audit/audit.service';
import { MIN_PASSWORD_LENGTH } from './password';

export class LoginDto {
  @IsEmail({}, { message: 'Correo inválido' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
  })
  newPassword: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  /** Acceso al panel de validación. Solo para personal acreditado. */
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  @UseGuards(OperatorGuard)
  @AllowPendingPassword()
  me(@CurrentOperator() operator: OperatorClaims) {
    return operator;
  }

  /**
   * Cambia la contraseña propia.
   *
   * Devuelve un token nuevo porque el cambio invalida todos los anteriores por
   * fecha de emisión: sin eso, quien acaba de cambiarla se quedaría sin sesión
   * justo después de hacer lo correcto.
   */
  @Post('password')
  @HttpCode(200)
  @UseGuards(OperatorGuard)
  @AllowPendingPassword()
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentOperator() operator: OperatorClaims,
    @Req() request: Request,
  ) {
    const result = await this.auth.changePassword(
      operator.sub,
      dto.currentPassword,
      dto.newPassword,
    );

    // Se registra el hecho, nunca la contraseña. Poder demostrar cuándo cambió
    // la credencial de quien accede a datos de personas es parte de lo que
    // exige la Ley 1581.
    await this.audit.record({
      actorId: operator.sub,
      actorName: operator.name,
      action: 'CHANGE_PASSWORD',
      entityType: 'Operator',
      entityId: operator.sub,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });

    return { accessToken: result.accessToken, mustChangePassword: false };
  }
}
