import { fromGeoPoint } from 'src/common/geo/geo.util';
import { MissingPersonReport } from 'src/modules/persons/entities/missing-person-report.entity';
import { SightingReport } from 'src/modules/persons/entities/sighting-report.entity';
import {
  MissingStatus,
  PersonCondition,
  Sex,
  SightingKind,
} from 'src/modules/persons/persons.enums';

/**
 * Serialización a PFIF 1.4 (People Finder Interchange Format).
 *
 * PFIF es el estándar abierto para intercambiar información de personas
 * desaparecidas entre registros distintos. Nació tras el huracán Katrina en
 * 2005, cuando la gente estaba usando más de veinticinco foros y registros
 * separados y nadie podía cruzarlos, y se usó después en Haití 2010 y Japón
 * 2011 a través de Google Person Finder.
 *
 * Importa aquí por una razón concreta: hoy no existe una API oficial colombiana
 * en vivo contra la cual sincronizar. El catálogo de emergencias de la UNGRD en
 * datos.gov.co llega hasta 2022 y el de desaparecidos se publica por lotes
 * mensuales. Exportar en PFIF no conecta nada de inmediato, pero hace que estos
 * datos PUEDAN entregarse mañana a la UNGRD, a la Cruz Roja o a otro registro
 * sin rehacer el modelo ni renegociar el formato.
 *
 * Mapeo:
 *   MissingPersonReport -> <person> + <note status="information_sought">
 *   SightingReport      -> <person> + <note status="believed_alive|believed_dead">
 *
 * Referencia: http://zesty.ca/pfif/1.4/
 */

export const PFIF_NAMESPACE = 'http://zesty.ca/pfif/1.4';

export type PfifScope = 'public' | 'full';

export interface PfifOptions {
  /** Dominio que prefija los identificadores, según exige la especificación. */
  domain: string;
  /**
   * `public` respeta el consentimiento de publicación y omite datos de contacto.
   * `full` incluye contacto y documento; solo para entrega a una entidad
   * oficial bajo un acuerdo de tratamiento de datos.
   */
  scope: PfifScope;
  /** Días tras los cuales el registro debe expirar en el sistema receptor. */
  expiryDays: number;
}

/** PFIF admite exactamente estos valores en `sex`. */
function pfifSex(sex: Sex): string | null {
  switch (sex) {
    case Sex.FEMALE:
      return 'female';
    case Sex.MALE:
      return 'male';
    case Sex.OTHER:
      return 'other';
    default:
      // UNKNOWN se omite: PFIF no tiene un valor para "no se sabe" y enviar
      // uno inventado rompería a los consumidores del estándar.
      return null;
  }
}

/**
 * Estado del avistamiento en el vocabulario de PFIF.
 *
 * `believed_dead` solo se emite cuando el avistamiento lo declara explícitamente
 * y viene de una fuente institucional. En cualquier otro caso se prefiere
 * `believed_alive` o `is_note_author`: propagar un fallecimiento no confirmado a
 * otros registros es un error que no se puede deshacer.
 */
function pfifStatus(sighting: SightingReport): string {
  if (sighting.kind === SightingKind.SELF_REPORT) return 'is_note_author';
  if (sighting.condition === PersonCondition.DECEASED) return 'believed_dead';
  return 'believed_alive';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Los caracteres de control son ilegales en XML 1.0 y aparecen cuando un
    // texto se pegó desde otra aplicación.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function tag(name: string, value: string | number | null | undefined, indent = '    '): string {
  if (value === null || value === undefined || value === '') return '';
  return `${indent}<pfif:${name}>${escapeXml(String(value))}</pfif:${name}>\n`;
}

function isoDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  // PFIF exige la forma UTC sin milisegundos.
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Divide un nombre completo en nombres y apellidos, sin inventar precisión. */
function splitName(fullName: string): { given: string | null; family: string | null } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return { given: fullName.trim() || null, family: null };

  // En el uso colombiano lo habitual son dos nombres y dos apellidos. Con
  // cuatro o más tokens se parte por la mitad; con dos o tres se toma el
  // último como apellido. Es una heurística, y por eso `full_name` —que es el
  // campo obligatorio en PFIF 1.4— siempre lleva el valor tal como se recibió.
  const split = parts.length >= 4 ? Math.ceil(parts.length / 2) : parts.length - 1;
  return {
    given: parts.slice(0, split).join(' ') || null,
    family: parts.slice(split).join(' ') || null,
  };
}

function buildPersonFromMissing(
  report: MissingPersonReport,
  options: PfifOptions,
  baseUrl: string,
): string {
  const { given, family } = splitName(report.fullName);
  const entryDate = isoDate(report.createdAt);
  const expiry = isoDate(new Date(report.createdAt.getTime() + options.expiryDays * 86_400_000));
  const full = options.scope === 'full';

  const description = [
    report.circumstances,
    report.distinguishingMarks ? `Señas particulares: ${report.distinguishingMarks}` : null,
    report.clothingDescription ? `Vestimenta: ${report.clothingDescription}` : null,
    report.heightCm ? `Estatura: ${report.heightCm} cm` : null,
    report.build ? `Contextura: ${report.build}` : null,
    report.hairColor ? `Cabello: ${report.hairColor}` : null,
    full && report.documentNumber ? `Documento: ${report.documentNumber}` : null,
  ]
    .filter(Boolean)
    .join('. ');

  let xml = '  <pfif:person>\n';
  xml += tag('person_record_id', `${options.domain}/${report.id}`);
  xml += tag('entry_date', entryDate);
  xml += tag('expiry_date', expiry);
  xml += tag('author_name', report.reporterName);
  if (full) {
    xml += tag('author_email', report.reporterEmail);
    xml += tag('author_phone', report.reporterPhone);
  }
  xml += tag('source_name', 'Reencuentro · Sismo Colombia 2026');
  xml += tag('source_date', entryDate);
  xml += tag('source_url', `${baseUrl}/desaparecidos/${report.id}`);
  // full_name es obligatorio en PFIF 1.4 y va sin transformar.
  xml += tag('full_name', report.fullName);
  xml += tag('given_name', given);
  xml += tag('family_name', family);
  xml += tag('alternate_names', report.aliases.join(', '));
  xml += tag('description', description);
  xml += tag('sex', pfifSex(report.sex));
  xml += tag('age', report.age ?? ageRange(report.ageMin, report.ageMax));
  xml += tag('home_city', report.municipality);
  xml += tag('home_state', report.department);
  xml += tag('home_country', 'Colombia');
  if (report.photos?.[0]) {
    xml += tag('photo_url', `${baseUrl}/media/${report.photos[0].storageKey}`);
  }

  // La nota que expresa "esta persona está siendo buscada".
  xml += '    <pfif:note>\n';
  xml += tag('note_record_id', `${options.domain}/note-${report.id}`, '      ');
  xml += tag('person_record_id', `${options.domain}/${report.id}`, '      ');
  xml += tag('entry_date', entryDate, '      ');
  xml += tag('author_name', report.reporterName, '      ');
  xml += tag('source_date', entryDate, '      ');
  xml += tag('author_made_contact', 'false', '      ');
  xml += tag('status', pfifNoteStatusForMissing(report.status), '      ');
  xml += tag('last_known_location', lastKnownLocation(report), '      ');
  xml += tag(
    'text',
    [
      report.circumstances ?? 'Reportada como desaparecida tras el sismo del 10 de agosto de 2026.',
      report.reporterRelationship ? `Relación con quien reporta: ${report.reporterRelationship}.` : null,
    ]
      .filter(Boolean)
      .join(' '),
    '      ',
  );
  xml += '    </pfif:note>\n';
  xml += '  </pfif:person>\n';

  return xml;
}

function pfifNoteStatusForMissing(status: MissingStatus): string {
  switch (status) {
    case MissingStatus.FOUND_ALIVE:
      return 'believed_alive';
    case MissingStatus.FOUND_DECEASED:
      return 'believed_dead';
    case MissingStatus.ACTIVE:
    case MissingStatus.MATCHED:
      return 'information_sought';
    default:
      return 'information_sought';
  }
}

function lastKnownLocation(report: MissingPersonReport): string | null {
  const parts = [report.lastSeenAddress, report.municipality, report.department].filter(Boolean);
  const coords = fromGeoPoint(report.lastSeenLocation);

  // La coordenada exacta de un menor no sale en la exportación pública: en el
  // listado abierto tampoco aparece, y una exportación no puede ser la puerta
  // trasera por la que se filtra lo que la interfaz protege.
  if (coords && !report.isMinor) {
    parts.push(`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
  }
  return parts.length ? parts.join(', ') : null;
}

function buildPersonFromSighting(
  sighting: SightingReport,
  options: PfifOptions,
  baseUrl: string,
): string {
  const entryDate = isoDate(sighting.createdAt);
  const seenAt = isoDate(sighting.seenAt);
  const expiry = isoDate(
    new Date(sighting.createdAt.getTime() + options.expiryDays * 86_400_000),
  );
  const full = options.scope === 'full';

  // PFIF exige full_name. Cuando el avistamiento no trae nombre —el caso más
  // frecuente y más importante: alguien inconsciente, un niño que no sabe su
  // apellido— se emite un marcador explícito en vez de omitir el registro. Un
  // registro sin nombre pero con descripción física y ubicación es exactamente
  // lo que otro registro necesita para cruzar.
  const fullName = sighting.fullName?.trim() || 'Persona sin identificar';
  const { given, family } = splitName(fullName);

  const description = [
    sighting.distinguishingMarks ? `Señas particulares: ${sighting.distinguishingMarks}` : null,
    sighting.clothingDescription ? `Vestimenta: ${sighting.clothingDescription}` : null,
    sighting.heightCm ? `Estatura: ${sighting.heightCm} cm` : null,
    sighting.build ? `Contextura: ${sighting.build}` : null,
    sighting.hairColor ? `Cabello: ${sighting.hairColor}` : null,
    full && sighting.documentNumber ? `Documento: ${sighting.documentNumber}` : null,
  ]
    .filter(Boolean)
    .join('. ');

  let xml = '  <pfif:person>\n';
  xml += tag('person_record_id', `${options.domain}/sighting-${sighting.id}`);
  xml += tag('entry_date', entryDate);
  xml += tag('expiry_date', expiry);
  xml += tag('author_name', sighting.reporterName ?? sighting.reporterOrganization);
  if (full) xml += tag('author_phone', sighting.reporterPhone);
  xml += tag('source_name', 'Reencuentro · Sismo Colombia 2026');
  xml += tag('source_date', seenAt);
  xml += tag('full_name', fullName);
  xml += tag('given_name', sighting.fullName ? given : null);
  xml += tag('family_name', sighting.fullName ? family : null);
  xml += tag('description', description);
  xml += tag('sex', pfifSex(sighting.sex));
  xml += tag('age', ageRange(sighting.estimatedAgeMin, sighting.estimatedAgeMax));
  xml += tag('home_city', sighting.municipality);
  xml += tag('home_state', sighting.department);
  xml += tag('home_country', 'Colombia');
  if (sighting.photos?.[0]) {
    xml += tag('photo_url', `${baseUrl}/media/${sighting.photos[0].storageKey}`);
  }

  xml += '    <pfif:note>\n';
  xml += tag('note_record_id', `${options.domain}/note-sighting-${sighting.id}`, '      ');
  xml += tag('person_record_id', `${options.domain}/sighting-${sighting.id}`, '      ');
  xml += tag('entry_date', entryDate, '      ');
  xml += tag('author_name', sighting.reporterName ?? sighting.reporterOrganization, '      ');
  xml += tag('source_date', seenAt, '      ');
  xml += tag('author_made_contact', 'true', '      ');
  xml += tag('status', pfifStatus(sighting), '      ');
  xml += tag(
    'last_known_location',
    [sighting.facilityName, sighting.address, sighting.municipality, sighting.department]
      .filter(Boolean)
      .join(', ') || null,
    '      ',
  );
  xml += tag(
    'text',
    [
      sighting.facilityName
        ? `Persona registrada en ${sighting.facilityName}.`
        : 'Persona vista en terreno.',
      sighting.notes,
      sighting.reporterOrganization ? `Reportado por ${sighting.reporterOrganization}.` : null,
    ]
      .filter(Boolean)
      .join(' '),
    '      ',
  );
  xml += '    </pfif:note>\n';
  xml += '  </pfif:person>\n';

  return xml;
}

function ageRange(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return min === max ? String(min) : `${min}-${max}`;
  return String(min ?? max);
}

export function buildPfifDocument(input: {
  missing: MissingPersonReport[];
  sightings: SightingReport[];
  options: PfifOptions;
  baseUrl: string;
}): string {
  const { missing, sightings, options, baseUrl } = input;

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<pfif:pfif xmlns:pfif="${PFIF_NAMESPACE}">\n`;

  for (const report of missing) {
    xml += buildPersonFromMissing(report, options, baseUrl);
  }
  for (const sighting of sightings) {
    xml += buildPersonFromSighting(sighting, options, baseUrl);
  }

  xml += '</pfif:pfif>\n';
  return xml;
}
