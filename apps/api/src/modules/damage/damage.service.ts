import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parseBbox } from 'src/common/geo/geo.util';
import { DamageAssessment } from './entities/damage-assessment.entity';
import { DamageCoverage } from './entities/damage-coverage.entity';

@Injectable()
export class DamageService {
  constructor(
    @InjectRepository(DamageAssessment)
    private readonly repo: Repository<DamageAssessment>,
    @InjectRepository(DamageCoverage)
    private readonly coverageRepo: Repository<DamageCoverage>,
  ) {}

  /**
   * Dónde se ha mirado.
   *
   * Es la contraparte imprescindible de la capa de daño. Un mapa que solo marca
   * lo dañado hace indistinguibles "aquí no hay daño" y "aquí nadie ha
   * evaluado", y en esta emergencia esas dos lecturas apuntan en direcciones
   * opuestas: las zonas sin evaluar son las aisladas, que es donde el daño es
   * más probable.
   */
  async coverage(): Promise<CoverageView[]> {
    const rows = await this.coverageRepo.find({ order: { city: 'ASC' } });
    return rows.map((row) => ({
      id: row.id,
      city: row.city,
      department: row.department,
      publisher: row.publisher,
      imagerySource: row.imagerySource,
      imageryDate: row.imageryDate,
      buildingsAssessed: row.buildingsAssessed,
      area: row.area,
    }));
  }

  /**
   * Edificaciones evaluadas dentro de la ventana visible.
   *
   * Devuelve el centroide además del polígono: a los niveles de zoom en que se
   * mira una ciudad entera, una huella de edificación mide menos de un píxel y
   * dibujarla es gastar ancho de banda para no mostrar nada. El cliente pinta
   * puntos cuando está lejos y polígonos cuando se acerca.
   */
  async query(options: {
    bbox?: string;
    city?: string;
    onlyDamaged?: boolean;
    limit?: number;
  }): Promise<DamageView[]> {
    // El centroide se calcula sobre la geometría, no sobre la geografía: para
    // una huella de veinte metros la diferencia es nula y el cálculo plano es
    // mucho más barato. ST_X y ST_Y solo aceptan puntos, así que se aplican al
    // resultado de ST_Centroid y nunca al polígono directamente.
    const qb = this.repo
      .createQueryBuilder('d')
      .addSelect('ST_Y(ST_Centroid(d."footprint"::geometry))', 'clat')
      .addSelect('ST_X(ST_Centroid(d."footprint"::geometry))', 'clon');

    if (options.onlyDamaged !== false) {
      qb.where('d.damaged = true');
    }
    if (options.city) {
      qb.andWhere('d.city = :city', { city: options.city });
    }
    if (options.bbox) {
      const box = parseBbox(options.bbox);
      qb.andWhere(
        `ST_Intersects(d."footprint"::geometry, ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326))`,
        box,
      );
    }

    const { entities, raw } = await qb
      .orderBy('d."damageRatio"', 'DESC', 'NULLS LAST')
      .limit(options.limit ?? 2000)
      .getRawAndEntities();

    return entities.map((entity, index) => ({
      id: entity.id,
      city: entity.city,
      buildingId: entity.buildingId,
      damaged: entity.damaged,
      damageRatio: entity.damageRatio,
      unknownRatio: entity.unknownRatio,
      footprint: entity.footprint,
      centroid: {
        latitude: Number(raw[index]?.clat ?? 0),
        longitude: Number(raw[index]?.clon ?? 0),
      },
      imageryDate: entity.imageryDate,
      imagerySource: entity.imagerySource,
      footprintSource: entity.footprintSource,
      publisher: entity.publisher,
    }));
  }

  /** Conteo por ciudad, para el tablero y para la leyenda del mapa. */
  async summary(): Promise<{
    porCiudad: {
      ciudad: string;
      evaluadas: number;
      danadas: number;
      fuenteImagen: string | null;
      fechaImagen: string | null;
      publicador: string;
    }[];
    totalDanadas: number;
    ciudadesEvaluadas: string[];
    aviso: string;
  }> {
    const rows = await this.repo
      .createQueryBuilder('d')
      .select('d.city', 'ciudad')
      .addSelect('COUNT(*)::int', 'evaluadas')
      .addSelect('COUNT(*) FILTER (WHERE d.damaged)::int', 'danadas')
      .addSelect('MAX(d."imagerySource")', 'fuenteImagen')
      .addSelect('MAX(d."imageryDate")', 'fechaImagen')
      .addSelect('MAX(d.publisher)', 'publicador')
      .groupBy('d.city')
      .orderBy('danadas', 'DESC')
      .getRawMany<{
        ciudad: string;
        evaluadas: number;
        danadas: number;
        fuenteImagen: string | null;
        fechaImagen: Date | null;
        publicador: string;
      }>();

    // El total analizado sale del área de cobertura, no de las filas cargadas:
    // solo se almacenan las edificaciones dañadas, así que contar filas diría
    // que en Pereira se evaluaron 309 cuando en realidad se evaluaron 35.760.
    const coverage = await this.coverageRepo.find();
    const assessedByCity = new Map(coverage.map((c) => [c.city, c.buildingsAssessed ?? 0]));

    return {
      porCiudad: rows.map((r) => ({
        ciudad: r.ciudad,
        evaluadas: assessedByCity.get(r.ciudad) ?? r.evaluadas,
        danadas: r.danadas,
        fuenteImagen: r.fuenteImagen,
        fechaImagen: r.fechaImagen ? r.fechaImagen.toISOString() : null,
        publicador: r.publicador,
      })),
      totalDanadas: rows.reduce((sum, r) => sum + r.danadas, 0),
      // Se nombra explícitamente lo que NO está cubierto. Callarlo dejaría que
      // el vacío del mapa se leyera como ausencia de daño.
      ciudadesEvaluadas: coverage.map((c) => c.city),
      aviso:
        'Solo se han publicado evaluaciones para ' +
        coverage.map((c) => c.city).join(' y ') +
        '. El resto del área afectada, incluido el Chocó donde estuvo el epicentro, ' +
        'no tiene evaluación publicada: la ausencia de datos no significa ausencia de daño.',
    };
  }
}

export interface CoverageView {
  id: string;
  city: string;
  department: string | null;
  publisher: string;
  imagerySource: string | null;
  imageryDate: Date | null;
  buildingsAssessed: number | null;
  area: DamageCoverage['area'];
}

export interface DamageView {
  id: string;
  city: string;
  buildingId: string | null;
  damaged: boolean;
  damageRatio: number | null;
  unknownRatio: number | null;
  footprint: DamageAssessment['footprint'];
  centroid: { latitude: number; longitude: number };
  imageryDate: Date | null;
  imagerySource: string | null;
  footprintSource: string | null;
  publisher: string;
}
