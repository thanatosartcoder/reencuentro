import { MigrationInterface, QueryRunner } from "typeorm";

export class ExternalSources1786735978019 implements MigrationInterface {
    name = 'ExternalSources1786735978019'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."idx_missing_active_location"`);
        await queryRunner.query(`DROP INDEX "public"."idx_match_pending_queue"`);
        await queryRunner.query(`DROP INDEX "public"."idx_zone_reports_revision"`);
        await queryRunner.query(`DROP INDEX "public"."idx_zone_active_location"`);
        await queryRunner.query(`ALTER TABLE "missing_person_reports" DROP CONSTRAINT "chk_missing_age_range"`);
        await queryRunner.query(`ALTER TABLE "person_photos" DROP CONSTRAINT "chk_photo_single_owner"`);
        await queryRunner.query(`ALTER TABLE "sighting_reports" DROP CONSTRAINT "chk_sighting_age_range"`);
        await queryRunner.query(`ALTER TABLE "match_candidates" DROP CONSTRAINT "chk_match_score"`);
        await queryRunner.query(`ALTER TABLE "zone_reports" DROP CONSTRAINT "chk_zone_severity"`);
        await queryRunner.query(`CREATE TABLE "seismic_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "source" character varying(20) NOT NULL, "externalId" character varying(60) NOT NULL, "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "magnitude" double precision NOT NULL, "magnitudeType" character varying(10), "depthKm" double precision, "location" geography(Point,4326) NOT NULL, "place" character varying(300), "distanceToMainshockKm" double precision, "isMainshock" boolean NOT NULL DEFAULT false, "tsunamiWarning" boolean NOT NULL DEFAULT false, "communityIntensity" double precision, "detailUrl" character varying(500), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b301e216adc95ede44f25d81642" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e55e06197ebbff03deac217747" ON "seismic_events" USING GiST ("location") `);
        await queryRunner.query(`CREATE INDEX "IDX_ec537be310ccf0a1969489b47e" ON "seismic_events" ("occurredAt") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f1a83360a09edbb31ac63ff234" ON "seismic_events" ("source", "externalId") `);
        await queryRunner.query(`CREATE TABLE "damage_assessments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "datasetId" character varying(120) NOT NULL, "publisher" character varying(120) NOT NULL, "imagerySource" character varying(60), "footprintSource" character varying(60), "city" character varying(120) NOT NULL, "department" character varying(100), "buildingId" character varying(120), "damaged" boolean NOT NULL DEFAULT false, "damageRatio" double precision, "unknownRatio" double precision, "footprint" geography(MultiPolygon,4326) NOT NULL, "imageryDate" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_778a4b4c7090fcc2d5be3ccb3b8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7d351d781f59233fd6069bae3d" ON "damage_assessments" ("datasetId") `);
        await queryRunner.query(`CREATE INDEX "IDX_889ee4b87c3a0cc7b2894f9c8a" ON "damage_assessments" USING GiST ("footprint") `);
        await queryRunner.query(`CREATE INDEX "IDX_e9c83bb68dd08c2234b7423745" ON "damage_assessments" ("city", "damaged") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_e9c83bb68dd08c2234b7423745"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_889ee4b87c3a0cc7b2894f9c8a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7d351d781f59233fd6069bae3d"`);
        await queryRunner.query(`DROP TABLE "damage_assessments"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f1a83360a09edbb31ac63ff234"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ec537be310ccf0a1969489b47e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e55e06197ebbff03deac217747"`);
        await queryRunner.query(`DROP TABLE "seismic_events"`);
        await queryRunner.query(`ALTER TABLE "zone_reports" ADD CONSTRAINT "chk_zone_severity" CHECK (((severity >= 1) AND (severity <= 5)))`);
        await queryRunner.query(`ALTER TABLE "match_candidates" ADD CONSTRAINT "chk_match_score" CHECK (((score >= (0)::double precision) AND (score <= (1)::double precision)))`);
        await queryRunner.query(`ALTER TABLE "sighting_reports" ADD CONSTRAINT "chk_sighting_age_range" CHECK ((("estimatedAgeMin" IS NULL) OR ("estimatedAgeMax" IS NULL) OR ("estimatedAgeMin" <= "estimatedAgeMax")))`);
        await queryRunner.query(`ALTER TABLE "person_photos" ADD CONSTRAINT "chk_photo_single_owner" CHECK (((("ownerType" = 'MISSING_REPORT'::person_photos_ownertype_enum) AND ("missingReportId" IS NOT NULL) AND ("sightingReportId" IS NULL)) OR (("ownerType" = 'SIGHTING_REPORT'::person_photos_ownertype_enum) AND ("sightingReportId" IS NOT NULL) AND ("missingReportId" IS NULL))))`);
        await queryRunner.query(`ALTER TABLE "missing_person_reports" ADD CONSTRAINT "chk_missing_age_range" CHECK ((("ageMin" IS NULL) OR ("ageMax" IS NULL) OR ("ageMin" <= "ageMax")))`);
        await queryRunner.query(`CREATE INDEX "idx_zone_active_location" ON "zone_reports" USING GiST ("location") WHERE ((status = 'ACTIVE'::zone_reports_status_enum) AND ("deletedAt" IS NULL))`);
        await queryRunner.query(`CREATE INDEX "idx_zone_reports_revision" ON "zone_reports" ("revision") `);
        await queryRunner.query(`CREATE INDEX "idx_match_pending_queue" ON "match_candidates" ("score", "highPriority", "createdAt") WHERE (status = 'PENDING_REVIEW'::match_candidates_status_enum)`);
        await queryRunner.query(`CREATE INDEX "idx_missing_active_location" ON "missing_person_reports" USING GiST ("lastSeenLocation") WHERE ((status = 'ACTIVE'::missing_person_reports_status_enum) AND ("deletedAt" IS NULL))`);
    }

}
