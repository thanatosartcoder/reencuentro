export enum Sex {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
  UNKNOWN = 'UNKNOWN',
}

export enum DocumentType {
  CC = 'CC',
  TI = 'TI',
  RC = 'RC',
  CE = 'CE',
  PASAPORTE = 'PASAPORTE',
  PEP = 'PEP',
  NINGUNO = 'NINGUNO',
}

export enum MissingStatus {
  /** Reporte abierto, la persona sigue sin localizar. */
  ACTIVE = 'ACTIVE',
  /** Hay al menos un candidato confirmado por un validador humano. */
  MATCHED = 'MATCHED',
  FOUND_ALIVE = 'FOUND_ALIVE',
  FOUND_DECEASED = 'FOUND_DECEASED',
  /** Otro reporte cubre a la misma persona; este quedo fusionado. */
  DUPLICATE = 'DUPLICATE',
  CANCELLED = 'CANCELLED',
}

/** De donde entro el reporte, para poder conciliar con el registro oficial. */
export enum ReportSource {
  APP = 'APP',
  UNGRD = 'UNGRD',
  CRUZ_ROJA = 'CRUZ_ROJA',
  DEFENSA_CIVIL = 'DEFENSA_CIVIL',
  BOMBEROS = 'BOMBEROS',
  FISCALIA = 'FISCALIA',
  IMPORT = 'IMPORT',
}

/** Contexto en el que se vio a la persona: cambia cuanta confianza merece. */
export enum SightingKind {
  SIGHTING = 'SIGHTING',
  SHELTER_INTAKE = 'SHELTER_INTAKE',
  HOSPITAL_ADMISSION = 'HOSPITAL_ADMISSION',
  RESCUE = 'RESCUE',
  MORGUE = 'MORGUE',
  SELF_REPORT = 'SELF_REPORT',
}

export enum PersonCondition {
  STABLE = 'STABLE',
  INJURED = 'INJURED',
  CRITICAL = 'CRITICAL',
  DECEASED = 'DECEASED',
  UNKNOWN = 'UNKNOWN',
}

export enum ReporterRole {
  CITIZEN = 'CITIZEN',
  FAMILY = 'FAMILY',
  RESCUER = 'RESCUER',
  HEALTH_STAFF = 'HEALTH_STAFF',
  OFFICIAL = 'OFFICIAL',
  VOLUNTEER = 'VOLUNTEER',
}

export enum MatchTier {
  /** Documento de identidad coincidente: match perfecto. */
  DETERMINISTIC = 'DETERMINISTIC',
  /** Comparacion facial por encima del umbral del proveedor. */
  BIOMETRIC = 'BIOMETRIC',
  /** Combinacion ponderada de nombre, edad, sexo, geografia y tiempo. */
  HEURISTIC = 'HEURISTIC',
}

export enum MatchStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  /** El reporte de origen se cerro por otra via antes de revisar el candidato. */
  SUPERSEDED = 'SUPERSEDED',
}

export enum PhotoOwnerType {
  MISSING_REPORT = 'MISSING_REPORT',
  SIGHTING_REPORT = 'SIGHTING_REPORT',
}
