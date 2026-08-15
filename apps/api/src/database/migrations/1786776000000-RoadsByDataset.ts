import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Permite que convivan varias descargas de red vial.
 *
 * La ingesta hacía `TRUNCATE road_segments` y recargaba todo. Con una sola
 * emergencia funcionaba, pero al cubrir la segunda —una inundación en otro
 * departamento, con su propio dataset regional— la carga nueva habría borrado
 * las vías de la anterior.
 *
 * Y esas vías siguen haciendo falta: alimentan el autocompletado al reportar un
 * tramo cortado del sismo que todavía está abierto. Perderlas dejaría a alguien
 * escribiendo el nombre de una carretera a mano en medio de una emergencia.
 *
 * Las vías **no** se atan a un evento: la geografía es la misma para todos. Se
 * atan a la descarga de la que salieron, que es lo que permite reemplazar una
 * sin tocar las otras.
 */
const DATASET_ACTUAL = 'col-earthquake-august-2026-openstreetmap-data';

export class RoadsByDataset1786776000000 implements MigrationInterface {
  name = 'RoadsByDataset1786776000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "road_segments" ADD COLUMN "datasetId" character varying(160)`,
    );
    await queryRunner.query(`UPDATE "road_segments" SET "datasetId" = $1`, [
      DATASET_ACTUAL,
    ]);
    await queryRunner.query(
      `ALTER TABLE "road_segments" ALTER COLUMN "datasetId" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_road_segments_dataset" ON "road_segments" ("datasetId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_road_segments_dataset"`);
    await queryRunner.query(`ALTER TABLE "road_segments" DROP COLUMN "datasetId"`);
  }
}
