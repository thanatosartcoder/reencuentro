import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Convierte la emergencia en una fila.
 *
 * Hasta aquí el sismo del 10 de agosto vivía como constantes en el código y
 * todo pertenecía implícitamente a él. Esto permite cubrir la siguiente sin
 * desplegar una copia entera de la plataforma.
 *
 * Aditiva: no toca ninguna tabla existente. El sismo actual se inserta con su
 * slug para que nada quede sin evento cuando las capas de contexto empiecen a
 * referenciarlo.
 */
export class Events1786768400000 implements MigrationInterface {
  name = 'Events1786768400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."events_kind_enum" AS ENUM
        ('EARTHQUAKE', 'FLOOD', 'LANDSLIDE', 'STORM', 'OTHER')
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."events_status_enum" AS ENUM
        ('ACTIVE', 'MONITORING', 'CLOSED')
    `);

    await queryRunner.query(`
      CREATE TABLE "events" (
        "id"             uuid NOT NULL DEFAULT uuid_generate_v4(),
        "slug"           character varying(120) NOT NULL,
        "name"           character varying(200) NOT NULL,
        "kind"           "public"."events_kind_enum" NOT NULL DEFAULT 'OTHER',
        "occurredAt"     TIMESTAMP WITH TIME ZONE NOT NULL,
        "epicenter"      geography(Point,4326),
        "searchRadiusKm" integer,
        "departments"    text array NOT NULL DEFAULT '{}',
        "status"         "public"."events_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "isPrimary"      boolean NOT NULL DEFAULT false,
        "createdAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_events" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_events_slug" ON "events" ("slug")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_events_status" ON "events" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_events_epicenter" ON "events" USING GiST ("epicenter")`,
    );

    // Un solo evento principal, garantizado por la base y no solo por el
    // código: con dos marcados, la portada mostraría uno u otro según el orden
    // de la consulta — la clase de fallo que nadie consigue reproducir.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_events_single_primary"
        ON "events" (("isPrimary")) WHERE "isPrimary" = true
    `);

    // El evento que ya estaba ocurriendo cuando se construyó esto. Los datos
    // provienen del Servicio Geológico Colombiano; las cifras de impacto se
    // quedan en código (situation.data.ts), indexadas por este mismo slug.
    await queryRunner.query(`
      INSERT INTO "events"
        ("slug", "name", "kind", "occurredAt", "epicenter", "searchRadiusKm", "departments", "status", "isPrimary")
      VALUES (
        'sismo-san-jose-del-palmar-2026',
        'Sismo de San José del Palmar',
        'EARTHQUAKE',
        '2026-08-10T12:34:00.000Z',
        ST_SetSRID(ST_MakePoint(-76.29, 4.99), 4326)::geography,
        300,
        ARRAY['Chocó','Valle del Cauca','Risaralda','Quindío','Caldas','Cauca','Antioquia'],
        'ACTIVE',
        true
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "events"`);
    await queryRunner.query(`DROP TYPE "public"."events_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."events_kind_enum"`);
  }
}
