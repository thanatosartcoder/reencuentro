/**
 * Declaraciones puente para los submódulos de stream-json 3.x.
 *
 * El paquete los publica con el mapa `"exports": { "./*": "./src/*" }`, que
 * Node resuelve sin problema pero TypeScript no, porque este proyecto usa
 * `moduleResolution: node` (la resolución clásica, anterior a los exports map).
 *
 * Cambiar el proyecto entero a `node16` por un script de ingesta sería mover un
 * cimiento para colgar un cuadro: afectaría la resolución de todos los imports
 * del backend. Estas declaraciones acotan el problema al único lugar donde
 * aparece, y describen solo lo que se usa: fábricas que devuelven un Duplex
 * para encadenar con `pipe`.
 */

declare module 'stream-json/filters/pick.js' {
  import { Duplex } from 'node:stream';

  interface PickOptions {
    filter: string | RegExp | ((path: unknown) => boolean);
    once?: boolean;
    pathSeparator?: string;
  }

  export const pick: {
    asStream(options?: PickOptions): Duplex;
  };
}

declare module 'stream-json/streamers/stream-array.js' {
  import { Duplex } from 'node:stream';

  export const streamArray: {
    asStream(options?: Record<string, unknown>): Duplex;
  };
}
