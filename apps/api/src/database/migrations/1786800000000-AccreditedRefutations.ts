import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separa la refutación acreditada de la de la comunidad.
 *
 * Hasta aquí, un voto firmado por el servidor contaba igual viniera de personal
 * acreditado o de un dispositivo anónimo con credencial. Firmar encarece
 * fabricar identidades, no lo impide: quien se moleste en pedir muchas puede
 * seguir llevando al suelo la confianza de una vía cortada.
 *
 * A partir de aquí sólo el tiempo y el personal acreditado pueden retirar un
 * peligro del mapa. La comunidad puede restarle credibilidad —hasta un suelo—
 * pero no hacerlo desaparecer. Sale del coste asimétrico que el propio módulo ya
 * reconoce: marcar como bloqueada una vía abierta desvía una ambulancia, pero
 * marcarla como abierta la manda contra un derrumbe.
 *
 * Las refutaciones existentes pasan a contar como de la comunidad, que es la
 * lectura conservadora: les quita poder, no se lo da.
 */
export class AccreditedRefutations1786800000000 implements MigrationInterface {
  name = 'AccreditedRefutations1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "zone_reports" ADD COLUMN "accreditedRefutations" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "zone_report_votes" ADD COLUMN "accredited" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "zone_report_votes" DROP COLUMN "accredited"`);
    await queryRunner.query(`ALTER TABLE "zone_reports" DROP COLUMN "accreditedRefutations"`);
  }
}
