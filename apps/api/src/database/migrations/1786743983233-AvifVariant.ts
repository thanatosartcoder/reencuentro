import { MigrationInterface, QueryRunner } from "typeorm";

export class AvifVariant1786743983233 implements MigrationInterface {
    name = 'AvifVariant1786743983233'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "person_photos" ADD "avifStorageKey" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "person_photos" ADD "avifSizeBytes" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "person_photos" DROP COLUMN "avifSizeBytes"`);
        await queryRunner.query(`ALTER TABLE "person_photos" DROP COLUMN "avifStorageKey"`);
    }

}
