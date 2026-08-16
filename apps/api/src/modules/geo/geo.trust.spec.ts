import { BadRequestException } from '@nestjs/common';
import { parseBbox } from 'src/common/geo/geo.util';
import { ReporterRole } from 'src/modules/persons/persons.enums';
import { confianzaBase, ROLE_BASE_CONFIDENCE } from './geo.service';
import { TrazadoValido } from './dto/create-zone-report.dto';

/**
 * Lo que decide cuánto pesa un reporte en el mapa.
 *
 * Estas tres piezas son la frontera entre "lo que alguien dice de sí mismo" y
 * "lo que el sistema se cree". Se prueban aparte porque son puras y porque el
 * fallo que cubren no se ve en una revisión: todo compila y funciona igual, solo
 * que un anónimo aparece con la credibilidad de un organismo oficial.
 */

describe('confianzaBase', () => {
  const elevados = [
    ReporterRole.OFFICIAL,
    ReporterRole.RESCUER,
    ReporterRole.HEALTH_STAFF,
  ];

  it.each(elevados)('no concede la credibilidad de %s sin acreditación', (rol) => {
    expect(confianzaBase(rol, false)).toBe(ROLE_BASE_CONFIDENCE[ReporterRole.VOLUNTEER]);
    expect(confianzaBase(rol, false)).toBeLessThan(ROLE_BASE_CONFIDENCE[rol]);
  });

  it.each(elevados)('sí la concede a %s cuando hay cuenta detrás', (rol) => {
    expect(confianzaBase(rol, true)).toBe(ROLE_BASE_CONFIDENCE[rol]);
  });

  it('deja intactos los roles que nadie necesita demostrar', () => {
    for (const rol of [ReporterRole.CITIZEN, ReporterRole.FAMILY, ReporterRole.VOLUNTEER]) {
      expect(confianzaBase(rol, false)).toBe(ROLE_BASE_CONFIDENCE[rol]);
      expect(confianzaBase(rol, true)).toBe(ROLE_BASE_CONFIDENCE[rol]);
    }
  });

  it('un anónimo nunca supera a un reporte acreditado del mismo tipo', () => {
    expect(confianzaBase(ReporterRole.OFFICIAL, false)).toBeLessThan(
      confianzaBase(ReporterRole.OFFICIAL, true),
    );
  });
});

describe('parseBbox', () => {
  it('acepta la ventana que envía el visor', () => {
    expect(parseBbox('-76.5,3.2,-76.1,3.6')).toEqual({
      minLon: -76.5,
      minLat: 3.2,
      maxLon: -76.1,
      maxLat: 3.6,
    });
  });

  it.each([
    ['pocos valores', '-76.5,3.2'],
    ['texto', 'a,b,c,d'],
    ['vacío', ''],
    ['inyección', "-76.5,3.2,-76.1,3.6); DROP TABLE zone_reports;--"],
  ])('rechaza %s como petición inválida, no como fallo del servidor', (_caso, entrada) => {
    // BadRequestException y no Error: un bbox mal formado salía como 500 y se
    // mezclaba con las caídas reales.
    expect(() => parseBbox(entrada)).toThrow(BadRequestException);
  });

  it.each([
    ['longitud fuera de rango', '-200,3.2,-76.1,3.6'],
    ['latitud fuera de rango', '-76.5,-95,-76.1,3.6'],
    ['esquinas invertidas', '-76.1,3.6,-76.5,3.2'],
  ])('rechaza %s en vez de devolver un mapa vacío', (_caso, entrada) => {
    expect(() => parseBbox(entrada)).toThrow(BadRequestException);
  });
});

describe('TrazadoValido', () => {
  const validador = new TrazadoValido();

  it('acepta un tramo real', () => {
    expect(validador.validate([[-76.5, 3.2], [-76.4, 3.25]])).toBe(true);
  });

  it.each([
    ['cadenas', [['a', 'b']]],
    ['objetos', [{ lat: 1, lon: 2 }]],
    ['pares incompletos', [[1]]],
    ['pares de más', [[1, 2, 3]]],
    ['no finitos', [[Infinity, 3.2]]],
    ['fuera de rango', [[-200, 3.2]]],
    ['nulos', [null]],
  ])('rechaza %s antes de que lleguen a PostGIS', (_caso, entrada) => {
    expect(validador.validate(entrada)).toBe(false);
  });
});
