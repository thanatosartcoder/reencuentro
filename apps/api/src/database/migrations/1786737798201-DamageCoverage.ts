import { MigrationInterface, QueryRunner } from "typeorm";

export class DamageCoverage1786737798201 implements MigrationInterface {
    name = 'DamageCoverage1786737798201'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "damage_coverage" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "datasetId" character varying(120) NOT NULL, "city" character varying(120) NOT NULL, "department" character varying(100), "publisher" character varying(120) NOT NULL, "imagerySource" character varying(60), "imageryDate" TIMESTAMP WITH TIME ZONE, "buildingsAssessed" integer, "area" geography(Polygon,4326) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6f952ffbb24d74a59324581b1c9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_28a0a4e8c43e076f2a331ac5c0" ON "damage_coverage" ("datasetId") `);
        await queryRunner.query(`CREATE INDEX "IDX_a14bd34d01cbb6b767ede5df20" ON "damage_coverage" USING GiST ("area") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_a14bd34d01cbb6b767ede5df20"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_28a0a4e8c43e076f2a331ac5c0"`);
        await queryRunner.query(`DROP TABLE "damage_coverage"`);
    }

}
