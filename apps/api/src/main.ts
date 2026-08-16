import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
loadEnv();

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { keyringInfo } from './common/crypto/field-crypto';

/**
 * Secretos que trae la instalación y nunca pueden firmar una sesión real.
 *
 * El primero es el valor por defecto del código; el segundo, el que copia
 * `.env.example` y que `init-env` deja intacto — a diferencia de la clave de
 * cifrado, que sí se genera al azar. Esa asimetría es justo la que hace que
 * este se olvide.
 */
const SECRETOS_DE_INSTALACION = new Set([
  'dev-secret-inseguro',
  'cambiar-este-secreto-en-produccion',
]);

/** Longitud mínima con la que un secreto HMAC resiste una búsqueda por fuerza bruta. */
const MIN_JWT_SECRET_LENGTH = 32;

function assertJwtSecret(config: ConfigService, logger: Logger): void {
  const secret = config.get<string>('jwt.secret') ?? '';
  const esProduccion = config.get<string>('nodeEnv') === 'production';

  const problema = SECRETOS_DE_INSTALACION.has(secret)
    ? 'JWT_SECRET sigue con el valor que trae la instalación, que está publicado en el repositorio.'
    : secret.length < MIN_JWT_SECRET_LENGTH
      ? `JWT_SECRET tiene ${secret.length} caracteres y el mínimo es ${MIN_JWT_SECRET_LENGTH}.`
      : null;

  if (!problema) return;

  // En producción no se arranca. En desarrollo se avisa y se sigue: pedir un
  // secreto propio para levantar la API en local no protege nada y sí estorba.
  if (esProduccion) {
    throw new Error(
      `${problema} Cualquiera podría firmar un token de administrador. ` +
        'Genera uno con: openssl rand -base64 48',
    );
  }

  logger.warn(`${problema} Aceptable en desarrollo, nunca en producción.`);
}

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

  // Igual que el llavero: se comprueba antes de escuchar. Un despliegue que
  // firma sesiones con el secreto que trae el repositorio es un panel de
  // validación abierto a cualquiera que sepa leerlo, y el síntoma no aparece
  // nunca — todo funciona, simplemente cualquiera puede fabricarse un token de
  // administrador.
  assertJwtSecret(config, logger);

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

// El fallo se registra y se sale con código distinto de cero. Sin este `catch`,
// un arranque abortado sale como "unhandled rejection" con una traza cruda, y en
// los registros de la plataforma eso se lee como un fallo del runtime en lugar
// de como lo que es: una variable de entorno que falta.
bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    `La API no pudo arrancar: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
