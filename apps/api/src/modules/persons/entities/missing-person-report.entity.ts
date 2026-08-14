import { Column, Entity, Index, OneToMany } from 'typeorm';
import { SyncableEntity } from 'src/common/entities/syncable.entity';
import { GeoPoint } from 'src/common/geo/geo.util';
import { encryptedText } from 'src/common/crypto/field-crypto';
import {
  DocumentType,
  MissingStatus,
  ReportSource,
  ReporterRole,
  Sex,
} from '../persons.enums';
import { PersonPhoto } from './person-photo.entity';

/**
 * Reporte de una persona desaparecida, levantado por un familiar o allegado.
 *
 * Casi todos los campos son opcionales a proposito: quien reporta desde una
 * zona de desastre muchas veces no sabe la fecha exacta, no tiene el documento
 * a mano y no puede precisar la ultima ubicacion. Exigir datos completos
 * significaria perder reportes.
 */
@Entity('missing_person_reports')
@Index(['status', 'department'])
export class MissingPersonReport extends SyncableEntity {
  // --- Identidad ---

  @Index()
  @Column({ type: 'varchar', length: 200 })
  fullName: string;

  /** Apodos y variantes con que la familia lo conoce; alimentan el matching. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  aliases: string[];

  @Column({ type: 'enum', enum: DocumentType, default: DocumentType.NINGUNO })
  documentType: DocumentType;

  /** Cifrado en reposo: identifica directamente a la persona. */
  @Column({ type: 'text', nullable: true, transformer: encryptedText })
  documentNumber: string | null;

  /** HMAC del documento normalizado. Permite match exacto sin descifrar. */
  @Index()
  @Column({ type: 'char', length: 64, nullable: true })
  documentHash: string | null;

  // --- Descripcion fisica ---

  @Column({ type: 'int', nullable: true })
  age: number | null;

  /**
   * Rango de edad estimado. Cuando la familia da una edad exacta se deriva de
   * ella con un margen; cuando solo dice "unos 40" se guarda 35-45. El matching
   * compara rangos, no numeros, porque del otro lado tambien hay estimaciones.
   */
  @Column({ type: 'int', nullable: true })
  ageMin: number | null;

  @Column({ type: 'int', nullable: true })
  ageMax: number | null;

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

  /** Cicatrices, tatuajes, protesis, lunares: lo que sobrevive a una foto mala. */
  @Column({ type: 'text', nullable: true })
  distinguishingMarks: string | null;

  /** Condiciones medicas relevantes para priorizar la busqueda. */
  @Column({ type: 'text', nullable: true })
  medicalNotes: string | null;

  @Column({ type: 'boolean', default: false })
  isMinor: boolean;

  // --- Ultima ubicacion conocida ---

  @Index({ spatial: true })
  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  lastSeenLocation: GeoPoint | null;

  @Column({ type: 'text', nullable: true })
  lastSeenAddress: string | null;

  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  department: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  municipality: string | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ type: 'text', nullable: true })
  circumstances: string | null;

  // --- Quien reporta ---

  @Column({ type: 'varchar', length: 200 })
  reporterName: string;

  @Column({ type: 'text', nullable: true, transformer: encryptedText })
  reporterPhone: string | null;

  @Index()
  @Column({ type: 'char', length: 64, nullable: true })
  reporterPhoneHash: string | null;

  @Column({ type: 'text', nullable: true, transformer: encryptedText })
  reporterEmail: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  reporterRelationship: string | null;

  @Column({ type: 'enum', enum: ReporterRole, default: ReporterRole.FAMILY })
  reporterRole: ReporterRole;

  /**
   * Hash del token que se le entrego al reportante. Es su unica credencial
   * para seguir el caso y recibir notificaciones sin necesidad de crear cuenta
   * (pedir registro en medio de una emergencia cuesta reportes).
   */
  @Index()
  @Column({ type: 'char', length: 64 })
  claimTokenHash: string;

  // --- Estado ---

  @Index()
  @Column({ type: 'enum', enum: MissingStatus, default: MissingStatus.ACTIVE })
  status: MissingStatus;

  @Column({ type: 'enum', enum: ReportSource, default: ReportSource.APP })
  source: ReportSource;

  /** Identificador del caso en el sistema oficial, cuando se concilia. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  externalReference: string | null;

  /** Reporte que absorbio a este cuando se detecto que eran la misma persona. */
  @Column({ type: 'uuid', nullable: true })
  mergedIntoId: string | null;

  @Column({ type: 'text', nullable: true })
  resolutionNotes: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  /**
   * El reportante autoriza publicar nombre y foto. Sin esto el caso existe para
   * el matching pero no aparece en el listado publico.
   */
  @Column({ type: 'boolean', default: true })
  consentPublicListing: boolean;

  @OneToMany(() => PersonPhoto, (photo) => photo.missingReport)
  photos: PersonPhoto[];
}
