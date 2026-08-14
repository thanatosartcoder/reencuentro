import { MigrationInterface, QueryRunner } from "typeorm";

export class RoadNetwork1786739062690 implements MigrationInterface {
    name = 'RoadNetwork1786739062690'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "road_segments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "osmId" bigint NOT NULL, "highway" character varying(40) NOT NULL, "name" character varying(250), "surface" character varying(60), "isBridge" boolean NOT NULL DEFAULT false, "isTunnel" boolean NOT NULL DEFAULT false, "oneway" character varying(20), "lengthMeters" double precision, "path" geography(LineString,4326) NOT NULL, "exportedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_32eb82f0761f8c1b20aee0b9d5c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4188a0428ff88dcbb78741ade4" ON "road_segments" ("osmId") `);
        await queryRunner.query(`CREATE INDEX "IDX_d0ba84b5f1b611cf9635972c88" ON "road_segments" USING GiST ("path") `);
        await queryRunner.query(`CREATE INDEX "IDX_2154f448bb0b5866cd84e879ca" ON "road_segments" ("name") `);
        await queryRunner.query(`CREATE INDEX "IDX_903ca8721415153c84e504a250" ON "road_segments" ("highway") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_903ca8721415153c84e504a250"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2154f448bb0b5866cd84e879ca"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d0ba84b5f1b611cf9635972c88"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4188a0428ff88dcbb78741ade4"`);
        await queryRunner.query(`DROP TABLE "road_segments"`);
    }

}
