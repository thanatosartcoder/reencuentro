import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extensiones y la maquinaria de revisiones para sincronizacion offline.
 *
 * Debe correr antes que cualquier migracion de esquema: las columnas
 * `geography` no existen sin PostGIS.
 */
export class Extensions1755000000000 implements MigrationInterface {
  name = 'Extensions1755000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
    // Busqueda difusa por nombre directamente en SQL, para prefiltrar candidatos
    // antes de traerlos a memoria.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);

    // Secuencia global compartida por todas las tablas sincronizables: da un
    // orden total entre tablas, de modo que un cliente puede pedir "lo que
    // cambio despues de la revision N" con una sola marca y sin ambiguedad.
    await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS global_revision_seq AS bigint START 1`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION set_revision() RETURNS trigger AS $$
      BEGIN
        NEW.revision := nextval('global_revision_seq');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS set_revision()`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS global_revision_seq`);
    // Las extensiones no se eliminan: otras bases o esquemas pueden depender
    // de ellas y su costo de permanencia es nulo.
  }
}
