import { MigrationInterface, QueryRunner } from 'typeorm';

/** Tablas que un cliente offline sincroniza y que por tanto llevan `revision`. */
const SYNCABLE_TABLES = ['missing_person_reports', 'sighting_reports', 'zone_reports'];

/**
 * Cierra el modelo con lo que TypeORM no puede expresar desde las entidades:
 * los triggers que alimentan la revision de sincronizacion y los indices
 * especializados que sostienen las dos consultas calientes del sistema
 * (buscar candidatos de match y pintar el mapa).
 */
export class RevisionTriggersAndIndexes1786732000000 implements MigrationInterface {
  name = 'RevisionTriggersAndIndexes1786732000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Revision automatica en INSERT y UPDATE ---
    for (const table of SYNCABLE_TABLES) {
      await queryRunner.query(`
        CREATE TRIGGER trg_${table}_revision
        BEFORE INSERT OR UPDATE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION set_revision();
      `);
      // Las filas creadas antes del trigger quedarian en revision 0 y un cliente
      // nunca las recibiria; se les asigna una revision valida ahora.
      await queryRunner.query(
        `UPDATE "${table}" SET "revision" = nextval('global_revision_seq') WHERE "revision" = 0`,
      );
    }

    // --- Busqueda difusa de nombres ---
    // `unaccent` se declara STABLE porque depende del diccionario activo, y
    // Postgres no indexa expresiones no inmutables. Fijar el diccionario de
    // forma explicita permite envolverla en una funcion IMMUTABLE indexable.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
      $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
    `);

    // El motor de matching prefiltra en SQL por similitud trigram antes de
    // traer candidatos a memoria; sin este indice esa consulta es un seq scan
    // sobre toda la tabla de desaparecidos.
    await queryRunner.query(`
      CREATE INDEX idx_missing_fullname_trgm
      ON "missing_person_reports" USING gin (lower(immutable_unaccent("fullName")) gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_sighting_fullname_trgm
      ON "sighting_reports" USING gin (lower(immutable_unaccent("fullName")) gin_trgm_ops)
    `);

    // --- Indices parciales sobre lo que esta activo ---
    // El mapa y la cola de matching solo miran reportes vigentes. Indexar solo
    // esas filas mantiene el indice pequeno aunque el historico crezca.
    await queryRunner.query(`
      CREATE INDEX idx_missing_active_location
      ON "missing_person_reports" USING gist ("lastSeenLocation")
      WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_zone_active_location
      ON "zone_reports" USING gist ("location")
      WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_match_pending_queue
      ON "match_candidates" ("highPriority" DESC, "score" DESC, "createdAt")
      WHERE "status" = 'PENDING_REVIEW'
    `);

    // --- Cursor de sincronizacion ---
    await queryRunner.query(`
      CREATE INDEX idx_zone_reports_revision ON "zone_reports" ("revision")
    `);

    // --- Integridad de dominio ---
    // Una foto pertenece a un reporte de desaparicion o a un avistamiento,
    // nunca a los dos ni a ninguno.
    await queryRunner.query(`
      ALTER TABLE "person_photos" ADD CONSTRAINT "chk_photo_single_owner" CHECK (
        ("ownerType" = 'MISSING_REPORT'  AND "missingReportId" IS NOT NULL AND "sightingReportId" IS NULL)
        OR
        ("ownerType" = 'SIGHTING_REPORT' AND "sightingReportId" IS NOT NULL AND "missingReportId" IS NULL)
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "zone_reports" ADD CONSTRAINT "chk_zone_severity"
      CHECK ("severity" BETWEEN 1 AND 5)
    `);
    await queryRunner.query(`
      ALTER TABLE "match_candidates" ADD CONSTRAINT "chk_match_score"
      CHECK ("score" >= 0 AND "score" <= 1)
    `);
    // Un rango de edad invertido produciria scores sin sentido en el matching.
    await queryRunner.query(`
      ALTER TABLE "missing_person_reports" ADD CONSTRAINT "chk_missing_age_range"
      CHECK ("ageMin" IS NULL OR "ageMax" IS NULL OR "ageMin" <= "ageMax")
    `);
    await queryRunner.query(`
      ALTER TABLE "sighting_reports" ADD CONSTRAINT "chk_sighting_age_range"
      CHECK ("estimatedAgeMin" IS NULL OR "estimatedAgeMax" IS NULL OR "estimatedAgeMin" <= "estimatedAgeMax")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sighting_reports" DROP CONSTRAINT "chk_sighting_age_range"`);
    await queryRunner.query(`ALTER TABLE "missing_person_reports" DROP CONSTRAINT "chk_missing_age_range"`);
    await queryRunner.query(`ALTER TABLE "match_candidates" DROP CONSTRAINT "chk_match_score"`);
    await queryRunner.query(`ALTER TABLE "zone_reports" DROP CONSTRAINT "chk_zone_severity"`);
    await queryRunner.query(`ALTER TABLE "person_photos" DROP CONSTRAINT "chk_photo_single_owner"`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_zone_reports_revision`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_match_pending_queue`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_zone_active_location`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_missing_active_location`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_sighting_fullname_trgm`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_missing_fullname_trgm`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS immutable_unaccent(text)`);

    for (const table of SYNCABLE_TABLES) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS trg_${table}_revision ON "${table}"`);
    }
  }
}
