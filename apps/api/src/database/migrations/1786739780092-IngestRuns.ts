import { MigrationInterface, QueryRunner } from "typeorm";

export class IngestRuns1786739780092 implements MigrationInterface {
    name = 'IngestRuns1786739780092'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."ingest_runs_source_enum" AS ENUM('HDX_DAMAGE', 'HOT_ROADS')`);
        await queryRunner.query(`CREATE TYPE "public"."ingest_runs_status_enum" AS ENUM('RUNNING', 'SUCCESS', 'SKIPPED', 'FAILED')`);
        await queryRunner.query(`CREATE TABLE "ingest_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "source" "public"."ingest_runs_source_enum" NOT NULL, "status" "public"."ingest_runs_status_enum" NOT NULL, "sourceVersion" character varying(120), "recordsLoaded" integer, "bytesDownloaded" integer, "error" text, "trigger" character varying(20) NOT NULL DEFAULT 'cron', "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "finishedAt" TIMESTAMP WITH TIME ZONE, "durationSeconds" integer, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_182d40b3089f639e72d9d70b59e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_25b9e85b31a98b2bd437ef227f" ON "ingest_runs" ("source") `);
        await queryRunner.query(`CREATE INDEX "IDX_f4319ce9e056a2911a7f56a09d" ON "ingest_runs" ("source", "startedAt") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_f4319ce9e056a2911a7f56a09d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_25b9e85b31a98b2bd437ef227f"`);
        await queryRunner.query(`DROP TABLE "ingest_runs"`);
        await queryRunner.query(`DROP TYPE "public"."ingest_runs_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."ingest_runs_source_enum"`);
    }

}
