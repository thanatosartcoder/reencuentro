import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ata las capas de contexto a su emergencia.
 *
 * El daño en edificaciones, su cobertura, las réplicas y los reportes del mapa
 * describen **una** emergencia concreta. Mezclarlos entre eventos daría un mapa
 * que suma derrumbes de dos catástrofes distintas como si fueran la misma.
 *
 * Las vías quedan fuera a propósito: la geografía no cambia entre eventos y
 * duplicarlas por cada emergencia multiplicaría 160.000 filas sin ganar nada.
 *
 * Los desaparecidos y los avistamientos también quedan fuera, y esa es la
 * decisión importante: llevarán el evento como etiqueta de contexto en otra
 * fase, nunca como partición. Alguien reportado tras este sismo puede ser visto
 * un año después durante otra emergencia, y el motor tiene que poder proponer
 * esa coincidencia.
 */
const SLUG = 'sismo-san-jose-del-palmar-2026';

/** Capa y si su columna admite nulos al terminar. */
const TABLAS = [
  'damage_assessments',
  'damage_coverage',
  'seismic_events',
  'zone_reports',
];

export class ScopeLayersToEvent1786772000000 implements MigrationInterface {
  name = 'ScopeLayersToEvent1786772000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const filas: { id: string }[] = await queryRunner.query(
      `SELECT id FROM "events" WHERE slug = $1`,
      [SLUG],
    );
    const id = filas[0]?.id;
    if (!id) {
      throw new Error(
        `No existe el evento ${SLUG}. La migración de eventos debe correr antes que esta.`,
      );
    }

    for (const tabla of TABLAS) {
      await queryRunner.query(`ALTER TABLE "${tabla}" ADD COLUMN "eventId" uuid`);

      // Todo lo que ya existe pertenece al sismo: es la única emergencia que se
      // ha cubierto hasta ahora.
      await queryRunner.query(`UPDATE "${tabla}" SET "eventId" = $1`, [id]);

      // Y a partir de aquí es obligatorio. Un dato de contexto sin emergencia no
      // significa nada: no se sabría en qué mapa mostrarlo ni cuándo caduca.
      await queryRunner.query(
        `ALTER TABLE "${tabla}" ALTER COLUMN "eventId" SET NOT NULL`,
      );

      // RESTRICT y no CASCADE: borrar un evento no puede llevarse por delante
      // los reportes que la comunidad hizo durante él sin que alguien lo decida
      // explícitamente.
      await queryRunner.query(`
        ALTER TABLE "${tabla}"
          ADD CONSTRAINT "FK_${tabla}_event"
          FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT
      `);

      await queryRunner.query(
        `CREATE INDEX "IDX_${tabla}_event" ON "${tabla}" ("eventId")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const tabla of TABLAS) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_${tabla}_event"`);
      await queryRunner.query(
        `ALTER TABLE "${tabla}" DROP CONSTRAINT IF EXISTS "FK_${tabla}_event"`,
      );
      await queryRunner.query(`ALTER TABLE "${tabla}" DROP COLUMN "eventId"`);
    }
  }
}
