import { Column, Entity, Index, OneToMany } from 'typeorm';
import { SyncableEntity } from 'src/common/entities/syncable.entity';
import { GeoPoint } from 'src/common/geo/geo.util';
import { encryptedText } from 'src/common/crypto/field-crypto';
import {
  DocumentType,
  PersonCondition,
  ReportSource,
  ReporterRole,
  Sex,
  SightingKind,
} from '../persons.enums';
import { PersonPhoto } from './person-photo.entity';

/**
 * "Vi a esta persona" / "tenemos a esta persona aqui".
 *
 * Lo reporta quien esta en terreno: un rescatista removiendo escombros, una
 * enfermera recibiendo heridos, el coordinador de un albergue, o la propia
 * persona marcandose como a salvo.
 *
 * A diferencia del reporte de desaparicion, aqui el nombre suele faltar: se
 * encuentra a alguien inconsciente o a un nino que no sabe su apellido. Por eso
 * la descripcion fisica y la ubicacion cargan casi todo el peso del matching.
 */
@Entity('sighting_reports')
@Index(['status', 'department'])
export class SightingReport extends SyncableEntity {
  @Column({ type: 'enum', enum: SightingKind, default: SightingKind.SIGHTING })
  kind: SightingKind;

  // --- Identidad, cuando se conoce ---

  @Index()
  @Column({ type: 'varchar', length: 200, nullable: true })
  fullName: string | null;

  @Column({ type: 'enum', enum: DocumentType, default: DocumentType.NINGUNO })
  documentType: DocumentType;

  @Column({ type: 'text', nullable: true, transformer: encryptedText })
  documentNumber: string | null;

  @Index()
  @Column({ type: 'char', length: 64, nullable: true })
  documentHash: string | null;

  // --- Descripcion observada ---

  @Column({ type: 'int', nullable: true })
  estimatedAgeMin: number | null;

  @Column({ type: 'int', nullable: true })
  estimatedAgeMax: number | null;

  @Column({ type: 'enum', enum: Sex, default: Sex.UNKNOWN })
  sex: Sex;

  @Column({ type: 'int', nullable: true })
  heightCm: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  build: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  skinTone: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  hairColor: string | null;

  @Column({ type: 'text', nullable: true })
  clothingDescription: string | null;

  @Column({ type: 'text', nullable: true })
  distinguishingMarks: string | null;

  @Column({ type: 'enum', enum: PersonCondition, default: PersonCondition.UNKNOWN })
  condition: PersonCondition;

  @Column({ type: 'boolean', default: false })
  isMinor: boolean;

  // --- Donde y cuando ---

  @Index({ spatial: true })
  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  location: GeoPoint | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  department: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  municipality: string | null;

  /** Hospital, albergue o punto de acopio donde esta la persona ahora. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  facilityName: string | null;

  @Index()
  @Column({ type: 'timestamptz' })
  seenAt: Date;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // --- Quien reporta ---

  @Column({ type: 'varchar', length: 200, nullable: true })
  reporterName: string | null;

  @Column({ type: 'text', nullable: true, transformer: encryptedText })
  reporterPhone: string | null;

  @Column({ type: 'enum', enum: ReporterRole, default: ReporterRole.CITIZEN })
  reporterRole: ReporterRole;

  /** Institucion que respalda el reporte; sube la confianza del avistamiento. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  reporterOrganization: string | null;

  @Column({ type: 'char', length: 64, nullable: true })
  claimTokenHash: string | null;

  @Column({ type: 'enum', enum: ReportSource, default: ReportSource.APP })
  source: ReportSource;

  // --- Estado ---

  @Index()
  @Column({ type: 'varchar', length: 32, default: 'OPEN' })
  status: 'OPEN' | 'RESOLVED' | 'DISCARDED';

  /** Momento en que se corrio el motor de matching sobre este avistamiento. */
  @Column({ type: 'timestamptz', nullable: true })
  matchedAt: Date | null;

  @OneToMany(() => PersonPhoto, (photo) => photo.sightingReport)
  photos: PersonPhoto[];
}
