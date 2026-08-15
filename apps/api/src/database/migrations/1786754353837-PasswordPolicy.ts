import { MigrationInterface, QueryRunner } from "typeorm";

export class PasswordPolicy1786754353837 implements MigrationInterface {
    name = 'PasswordPolicy1786754353837'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "operators" ADD "passwordChangedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "operators" ADD "mustChangePassword" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "operators" DROP COLUMN "mustChangePassword"`);
        await queryRunner.query(`ALTER TABLE "operators" DROP COLUMN "passwordChangedAt"`);
    }

}
