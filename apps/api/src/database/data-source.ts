import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { join } from 'node:path';

loadEnv();

// Se tipa como PostgresConnectionOptions y no como la union DataSourceOptions
// para que app.module pueda extenderlo campo a campo sin que TypeScript
// considere variantes de otros motores.
export const dataSourceOptions: PostgresConnectionOptions = {
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5433),
  username: process.env.DB_USER ?? 'reencuentro',
  password: process.env.DB_PASSWORD ?? 'reencuentro',
  database: process.env.DB_NAME ?? 'reencuentro',
  // El esquema se maneja siempre por migraciones: con datos de una emergencia
  // real en la tabla, dejar que TypeORM altere el esquema solo es inaceptable.
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
};

// La CLI de TypeORM exige que el archivo exporte exactamente una instancia de
// DataSource, asi que no se agrega un export default duplicado.
export const AppDataSource = new DataSource(dataSourceOptions);
