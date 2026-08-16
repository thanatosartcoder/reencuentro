import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separa el voto verificado del que no lo está.
 *
 * La confianza de un reporte del mapa se calcula con dos contadores:
 * confirmaciones y refutaciones. La única defensa contra votar muchas veces era
 * un `deviceId` que enviaba el propio cliente — o sea, se le preguntaba al
 * votante quién era y se le creía. Con identificadores inventados, unas pocas
 * peticiones bastaban para llevar al suelo la confianza de una vía cortada y
 * sacarla del mapa.
 *
 * A partir de aquí los contadores existentes cuentan **solo votos firmados por
 * el servidor**, y los anónimos van a columnas aparte. La fórmula de confianza
 * mira los primeros; los segundos siguen visibles como señal de la comunidad,
 * pero no pueden esconder nada.
 *
 * Los votos ya existentes se dan por verificados. No es que lo estén: es que
 * reclasificarlos hacia abajo cambiaría la confianza de reportes vivos sin que
 * nadie lo hubiera pedido, y en producción no hay ninguno con refutaciones —así
 * que la diferencia es teórica y la opción conservadora no cuesta nada.
 */
export class VerifiedZoneVotes1786790000000 implements MigrationInterface {
  name = 'VerifiedZoneVotes1786790000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "zone_report_votes" ADD COLUMN "verified" boolean NOT NULL DEFAULT false`,
    );
    // Lo ya emitido se trata como verificado, por lo dicho arriba.
    await queryRunner.query(`UPDATE "zone_report_votes" SET "verified" = true`);

    await queryRunner.query(
      `ALTER TABLE "zone_reports" ADD COLUMN "unverifiedConfirmations" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "zone_reports" ADD COLUMN "unverifiedRefutations" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "zone_reports" DROP COLUMN "unverifiedRefutations"`);
    await queryRunner.query(`ALTER TABLE "zone_reports" DROP COLUMN "unverifiedConfirmations"`);
    await queryRunner.query(`ALTER TABLE "zone_report_votes" DROP COLUMN "verified"`);
  }
}
