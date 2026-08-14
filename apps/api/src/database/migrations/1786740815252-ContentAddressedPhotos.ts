import { MigrationInterface, QueryRunner } from "typeorm";

export class ContentAddressedPhotos1786740815252 implements MigrationInterface {
    name = 'ContentAddressedPhotos1786740815252'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "person_photos" ADD "contentHash" character(64) NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_b5408758f3fae7224fdb6c10ee" ON "person_photos" ("contentHash") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_b5408758f3fae7224fdb6c10ee"`);
        await queryRunner.query(`ALTER TABLE "person_photos" DROP COLUMN "contentHash"`);
    }

}
