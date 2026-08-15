import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Operator } from './entities/operator.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { OperatorGuard } from './auth.guard';
import { OperatorsService } from './operators.service';
import { OperatorsController } from './operators.controller';

/**
 * Global porque el guard de operadores se usa desde varios modulos y no tiene
 * sentido reimportarlo en cada uno.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Operator]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.get<string>('jwt.secret'),
        // jsonwebtoken tipa expiresIn como un literal de plantilla ("12h", "7d");
        // el valor llega desde el entorno como string y no puede estrecharse
        // en tiempo de compilacion.
        signOptions: { expiresIn: config.get<string>('jwt.expiresIn') ?? '12h' } as JwtSignOptions,
      }),
    }),
  ],
  controllers: [AuthController, OperatorsController],
  providers: [AuthService, OperatorGuard, OperatorsService],
  exports: [AuthService, OperatorGuard, OperatorsService, JwtModule],
})
export class AuthModule {}
