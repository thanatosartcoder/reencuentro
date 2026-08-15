import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Invitaciones para dar de alta personal acreditado.
 *
 * Hasta aquí las únicas cuentas capaces de validar eran las dos que sembraba la
 * instalación, y sumar una tercera exigía SQL a mano. Como la revisión humana
 * es la puerta por la que pasa cada aviso a una familia, ese límite se medía en
 * tiempo de espera de gente buscando a alguien.
 *
 * La credencial va partida en dos: enlace y código, por canales distintos.
 */
export class OperatorInvitations1786761200000 implements MigrationInterface {
  name = 'OperatorInvitations1786761200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nulo mientras la invitación esté pendiente: la cuenta existe pero todavía
    // no puede entrar.
    await queryRunner.query(
      `ALTER TABLE "operators" ALTER COLUMN "passwordHash" DROP NOT NULL`,
    );

    await queryRunner.query(`
      ALTER TABLE "operators"
        ADD COLUMN "invitationTokenHash" char(64),
        ADD COLUMN "invitationCodeHash"  char(64),
        ADD COLUMN "invitationAttempts"  integer NOT NULL DEFAULT 0,
        ADD COLUMN "invitationExpiresAt" timestamptz,
        ADD COLUMN "invitedById"         uuid,
        ADD COLUMN "invitedByName"       varchar(200),
        ADD COLUMN "invitedAt"           timestamptz
    `);

    // Parcial: solo las invitaciones vivas se buscan por token, y son unas
    // pocas frente a la tabla entera.
    await queryRunner.query(`
      CREATE INDEX "IDX_operators_invitation_token"
        ON "operators" ("invitationTokenHash")
        WHERE "invitationTokenHash" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_operators_invitation_token"`);
    await queryRunner.query(`
      ALTER TABLE "operators"
        DROP COLUMN "invitationTokenHash",
        DROP COLUMN "invitationCodeHash",
        DROP COLUMN "invitationAttempts",
        DROP COLUMN "invitationExpiresAt",
        DROP COLUMN "invitedById",
        DROP COLUMN "invitedByName",
        DROP COLUMN "invitedAt"
    `);

    // Al revertir puede haber cuentas invitadas sin contraseña; se desactivan
    // en vez de romper la restricción o inventarles una credencial.
    await queryRunner.query(
      `UPDATE "operators" SET "isActive" = false, "passwordHash" = '!' WHERE "passwordHash" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "operators" ALTER COLUMN "passwordHash" SET NOT NULL`,
    );
  }
}
