import { fromGeoPoint } from 'src/common/geo/geo.util';
import type { PersonPhoto } from './entities/person-photo.entity';
import { MissingPersonReport } from './entities/missing-person-report.entity';
import { SightingReport } from './entities/sighting-report.entity';

/**
 * Proyecciones de salida.
 *
 * Una entidad nunca se serializa directamente hacia el cliente. Las columnas
 * cifradas se descifran en memoria al leerlas, asi que devolver la entidad tal
 * cual expondria telefono, correo y documento a cualquiera que consulte el
 * listado publico. Las vistas de aqui deciden explicitamente que sale.
 */

/**
 * Una foto con sus dos variantes.
 *
 * `url` es la canónica y siempre existe; `urlAvif` es opcional. El cliente las
 * ofrece en un `<picture>` y el navegador elige la que sabe decodificar. Esa
 * negociación en el cliente no cuesta ninguna consulta al servidor y deja que
 * el CDN cachee cada variante bajo su propia dirección.
 */
export function toPhotoView(photo: PersonPhoto) {
  return {
    id: photo.id,
    url: `/media/${photo.storageKey}`,
    urlAvif: photo.avifStorageKey ? `/media/${photo.avifStorageKey}` : null,
    width: photo.width,
    height: photo.height,
  };
}

/**
 * Reduce una coordenada a la precision que declara su nombre.
 *
 * Dos decimales son algo mas de un kilometro: sigue diciendo en que parte del
 * municipio fue, que es lo que necesita quien busca, y deja de decir en que
 * casa. La version anterior devolvia el punto GPS exacto bajo un campo llamado
 * "aproximada" — la palabra estaba en el nombre y en el comentario, pero no en
 * los datos, y ese es el tipo de diferencia que nadie revisa dos veces.
 *
 * Se redondea al presentar y no al guardar: el motor de coincidencias y el panel
 * de validacion necesitan el punto exacto para decidir si dos reportes son la
 * misma persona.
 */
function blur(
  coords: { latitude: number; longitude: number } | null,
): { latitude: number; longitude: number } | null {
  if (!coords) return null;
  return {
    latitude: Math.round(coords.latitude * 100) / 100,
    longitude: Math.round(coords.longitude * 100) / 100,
  };
}

/** Lo que ve cualquiera: suficiente para reconocer a alguien, nada mas. */
export function toPublicMissing(report: MissingPersonReport) {
  const coords = fromGeoPoint(report.lastSeenLocation);
  return {
    id: report.id,
    fullName: report.fullName,
    aliases: report.aliases,
    age: report.age,
    ageMin: report.ageMin,
    ageMax: report.ageMax,
    sex: report.sex,
    heightCm: report.heightCm,
    build: report.build,
    skinTone: report.skinTone,
    hairColor: report.hairColor,
    clothingDescription: report.clothingDescription,
    distinguishingMarks: report.distinguishingMarks,
    isMinor: report.isMinor,
    // Solo municipio y departamento. La coordenada exacta de la ultima
    // ubicacion de un menor desaparecido no se publica: quien necesita ese
    // dato para buscar tiene acceso autenticado.
    department: report.department,
    municipality: report.municipality,
    lastSeenApproximateLocation: report.isMinor ? null : blur(coords),
    lastSeenAt: report.lastSeenAt,
    circumstances: report.circumstances,
    status: report.status,
    reportedAt: report.createdAt,
    hasPhoto: (report.photos?.length ?? 0) > 0,
    photos: (report.photos ?? []).map(toPhotoView),
  };
}

/** Lo que ve el propio reportante con su claim token: incluye sus datos de contacto. */
export function toOwnerMissing(report: MissingPersonReport) {
  return {
    ...toPublicMissing(report),
    lastSeenLocation: fromGeoPoint(report.lastSeenLocation),
    lastSeenAddress: report.lastSeenAddress,
    documentType: report.documentType,
    documentNumber: report.documentNumber,
    medicalNotes: report.medicalNotes,
    reporterName: report.reporterName,
    reporterPhone: report.reporterPhone,
    reporterEmail: report.reporterEmail,
    reporterRelationship: report.reporterRelationship,
    consentPublicListing: report.consentPublicListing,
    resolutionNotes: report.resolutionNotes,
    resolvedAt: report.resolvedAt,
    clientUuid: report.clientUuid,
    revision: report.revision,
  };
}

/**
 * Lo que ve un validador acreditado: todo, porque tiene que poder decidir si
 * dos registros son la misma persona. Cada lectura queda en la bitacora.
 */
export function toOperatorMissing(report: MissingPersonReport) {
  return {
    ...toOwnerMissing(report),
    source: report.source,
    externalReference: report.externalReference,
    mergedIntoId: report.mergedIntoId,
    updatedAt: report.updatedAt,
  };
}

export function toPublicSighting(sighting: SightingReport) {
  const coords = fromGeoPoint(sighting.location);
  return {
    id: sighting.id,
    kind: sighting.kind,
    fullName: sighting.fullName,
    estimatedAgeMin: sighting.estimatedAgeMin,
    estimatedAgeMax: sighting.estimatedAgeMax,
    sex: sighting.sex,
    heightCm: sighting.heightCm,
    build: sighting.build,
    skinTone: sighting.skinTone,
    hairColor: sighting.hairColor,
    clothingDescription: sighting.clothingDescription,
    distinguishingMarks: sighting.distinguishingMarks,
    // El estado de salud es un dato sensible: se publica que la persona fue
    // vista, no en que condicion. El detalle queda para el validador y la
    // familia, no para el listado abierto.
    isMinor: sighting.isMinor,
    department: sighting.department,
    municipality: sighting.municipality,
    facilityName: sighting.facilityName,
    approximateLocation: sighting.isMinor ? null : blur(coords),
    seenAt: sighting.seenAt,
    status: sighting.status,
    reportedAt: sighting.createdAt,
    photos: (sighting.photos ?? []).map(toPhotoView),
  };
}

export function toOperatorSighting(sighting: SightingReport) {
  return {
    ...toPublicSighting(sighting),
    condition: sighting.condition,
    location: fromGeoPoint(sighting.location),
    address: sighting.address,
    documentType: sighting.documentType,
    documentNumber: sighting.documentNumber,
    notes: sighting.notes,
    reporterName: sighting.reporterName,
    reporterPhone: sighting.reporterPhone,
    reporterRole: sighting.reporterRole,
    reporterOrganization: sighting.reporterOrganization,
    source: sighting.source,
    clientUuid: sighting.clientUuid,
    revision: sighting.revision,
  };
}
