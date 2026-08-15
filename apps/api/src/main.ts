import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
loadEnv();

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { keyringInfo } from './common/crypto/field-crypto';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // El llavero se valida aquí, antes de escuchar. Se carga de forma perezosa,
  // así que un identificador mal escrito en FIELD_ENCRYPTION_ACTIVE no fallaría
  // al arrancar: fallaría la primera vez que alguien intenta reportar a una
  // persona desaparecida. Comprobarlo ahora convierte ese error en un despliegue
  // que no sale, que es cuando todavía no le cuesta nada a nadie.
  const llavero = keyringInfo();
  logger.log(
    `Cifrado de campos: claves [${llavero.ids.join(', ')}], activa ${llavero.activeId}`,
  );

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      // Descarta campos no declarados en el DTO en lugar de persistirlos.
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableCors({
    origin: config.get<string[]>('corsOrigins'),
    credentials: true,
  });

  // Un cliente offline puede llegar con un lote grande de reportes acumulados.
  app.useBodyParser('json', { limit: '5mb' });

  const port = config.get<number>('port') ?? 4000;
  // Se enlaza explícitamente a todas las interfaces. Dentro de un contenedor,
  // escuchar solo en localhost hace que el healthcheck de la plataforma no
  // alcance nunca al proceso, y el síntoma es idéntico al de una app caída.
  await app.listen(port, '0.0.0.0');
  logger.log(`API escuchando en el puerto ${port} (prefijo /api)`);
}

void bootstrap();
