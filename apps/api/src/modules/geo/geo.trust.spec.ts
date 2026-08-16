import { BadRequestException } from '@nestjs/common';
import { parseBbox } from 'src/common/geo/geo.util';
import { ReporterRole } from 'src/modules/persons/persons.enums';
import {
  CONFIRMATION_WEIGHT,
  DEFAULT_MIN_CONFIDENCE,
  MAX_REFUTATIONS_COUNTED,
  SUELO_COMUNIDAD,
  REFUTATION_WEIGHT,
  confianzaBase,
  ROLE_BASE_CONFIDENCE,
} from './geo.service';
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

/**
 * Cuánto cuesta esconder un reporte del mapa.
 *
 * Se fija en una prueba porque son constantes de una línea que se ajustan sin
 * pensar, y aquí ajustarlas cambia cuántas peticiones HTTP hacen falta para que
 * una vía cortada deje de verse. La fórmula se replica en lugar de consultarse
 * en SQL: si alguien cambia una y no la otra, esto lo delata.
 */
describe('coste de enterrar un reporte', () => {
  const confianza = (base: number, refutaciones: number) =>
    Math.max(
      0,
      Math.min(1, base - REFUTATION_WEIGHT * Math.min(refutaciones, MAX_REFUTATIONS_COUNTED)),
    );

  const refutacionesParaOcultar = (base: number) => {
    for (let n = 1; n <= 50; n++) if (confianza(base, n) < DEFAULT_MIN_CONFIDENCE) return n;
    return Infinity;
  };

  it('una refutación pesa menos que una confirmación', () => {
    // Al revés era: retirar un bloqueo salía más barato que confirmarlo, y el
    // error caro es mandar una ambulancia contra un derrumbe.
    expect(REFUTATION_WEIGHT).toBeLessThan(CONFIRMATION_WEIGHT);
  });

  it('un reporte ciudadano aguanta más de una refutación anónima', () => {
    // Con los pesos viejos bastaba 1 para dejarlo en el umbral y 2 para borrarlo.
    expect(refutacionesParaOcultar(ROLE_BASE_CONFIDENCE.CITIZEN)).toBe(4);
  });

  it('un reporte de voluntario aguanta más todavía', () => {
    expect(refutacionesParaOcultar(ROLE_BASE_CONFIDENCE.VOLUNTEER)).toBe(6);
  });

  it('un reporte acreditado no se puede ocultar por esta vía', () => {
    // El tope de refutaciones contadas le pone suelo.
    expect(refutacionesParaOcultar(ROLE_BASE_CONFIDENCE.OFFICIAL)).toBe(Infinity);
    expect(confianza(ROLE_BASE_CONFIDENCE.OFFICIAL, 999)).toBeCloseTo(0.26, 5);
  });
});

/**
 * Lo que la comunidad NO puede hacer.
 *
 * La regla en una frase: nada anónimo puede hacer desaparecer un peligro del
 * mapa. Se fija aquí porque es una propiedad, no un número: alguien que ajuste
 * los pesos en el futuro puede romperla sin darse cuenta, y el síntoma sería una
 * vía cortada que deja de verse porque un atacante pidió credenciales suficientes.
 */
describe('suelo de la comunidad', () => {
  // Réplica de la fórmula SQL. Si alguien cambia una y no la otra, esto lo dice.
  const credibilidad = (base: number, comunidad: number, acreditadas: number) => {
    const acr = base - REFUTATION_WEIGHT * Math.min(acreditadas, MAX_REFUTATIONS_COUNTED);
    const con = acr - REFUTATION_WEIGHT * Math.min(comunidad, MAX_REFUTATIONS_COUNTED);
    return Math.max(0, Math.min(1, Math.max(con, Math.min(acr, SUELO_COMUNIDAD))));
  };

  it('el suelo deja exactamente una vida media de visibilidad', () => {
    // Es la relación que se está eligiendo: el umbral se compara tras el
    // decaimiento, así que 2× umbral = una vida media más de vida.
    expect(SUELO_COMUNIDAD).toBe(2 * DEFAULT_MIN_CONFIDENCE);
  });

  it.each([1, 8, 100, 10_000])(
    'con %i refutaciones de la comunidad el reporte sigue visible',
    (n) => {
      expect(credibilidad(ROLE_BASE_CONFIDENCE.CITIZEN, n, 0)).toBeGreaterThanOrEqual(
        DEFAULT_MIN_CONFIDENCE,
      );
    },
  );

  it('un reporte acreditado tampoco se hunde por la comunidad', () => {
    expect(credibilidad(ROLE_BASE_CONFIDENCE.OFFICIAL, 10_000, 0)).toBeGreaterThanOrEqual(
      DEFAULT_MIN_CONFIDENCE,
    );
  });

  it('el personal acreditado sí puede retirarlo', () => {
    // Cuatro personas distintas con cuenta: un reporte ciudadano desaparece.
    expect(credibilidad(ROLE_BASE_CONFIDENCE.CITIZEN, 0, 4)).toBeLessThan(DEFAULT_MIN_CONFIDENCE);
  });

  it('el suelo nunca sube lo que un operador ya hundió', () => {
    const soloOperadores = credibilidad(ROLE_BASE_CONFIDENCE.CITIZEN, 0, 4);
    const conComunidadTambien = credibilidad(ROLE_BASE_CONFIDENCE.CITIZEN, 8, 4);
    expect(conComunidadTambien).toBeLessThanOrEqual(soloOperadores);
  });

  it('sin refutaciones la credibilidad no cambia', () => {
    for (const base of Object.values(ROLE_BASE_CONFIDENCE)) {
      expect(credibilidad(base, 0, 0)).toBeCloseTo(base, 5);
    }
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
