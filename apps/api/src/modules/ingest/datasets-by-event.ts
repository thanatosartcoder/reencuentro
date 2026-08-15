import { DAMAGE_DATASETS, type HdxDamageDataset } from './hdx-damage.ingester';

/**
 * Qué fuentes externas alimentan cada emergencia.
 *
 * Vive en código y no en base de datos, por la misma razón que las cifras
 * oficiales: son referencias a datasets de terceros y cada cambio tiene que
 * quedar auditable con su fecha y su origen. En git eso es el historial; en una
 * tabla sería un `UPDATE` sin rastro.
 *
 * También tiene una consecuencia práctica buena: dar de alta las fuentes de una
 * emergencia nueva obliga a mirar qué publicó cada organismo y con qué
 * cobertura, en vez de pegar un identificador en un formulario. Esa capa parcial
 * hay que declararla bien — un mapa que dice "sin daño" donde nadie evaluó es
 * peor que un mapa vacío.
 *
 * Una emergencia sin entrada aquí no es un error: significa que todavía no hay
 * datasets publicados para ella. Sus reportes de la comunidad funcionan igual.
 */
export interface EventDatasets {
  /** Evaluaciones de daño por satélite. Vacío mientras nadie publique. */
  damage: HdxDamageDataset[];
  /**
   * Red vial regional. Las vías no se atan al evento —la geografía es la misma
   * para todos— pero sí la descarga de la que salen, para poder añadir una
   * región sin borrar las demás.
   */
  roads: { datasetId: string; url: string; exportedAt: string } | null;
}

export const HOT_ROADS_CHOCO = {
  datasetId: 'col-earthquake-august-2026-openstreetmap-data',
  url: 'https://data.humdata.org/dataset/e8bdd009-7844-40d5-9093-80a692ace688/resource/a47602bc-7436-4a79-95c6-145836a1269d/download/colombia_eq_roads_13aug2026_geojson.zip',
  exportedAt: '2026-08-13T10:23:29.000Z',
};

const DATASETS_BY_EVENT: Record<string, EventDatasets> = {
  'sismo-san-jose-del-palmar-2026': {
    // Microsoft AI for Good Lab publicó Cali y Pereira. El resto del área
    // afectada, incluido el Chocó del epicentro, sigue sin evaluar — y el mapa
    // lo dice explícitamente en vez de mostrarlo como si no hubiera daño.
    damage: DAMAGE_DATASETS,
    roads: HOT_ROADS_CHOCO,
  },
};

export function datasetsFor(slug: string): EventDatasets {
  return DATASETS_BY_EVENT[slug] ?? { damage: [], roads: null };
}
