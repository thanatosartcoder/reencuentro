import 'reflect-metadata';
import { DataSource } from 'typeorm';
import {
  decryptField,
  encryptField,
  keyIdOf,
  keyringInfo,
  resetKeyringCache,
} from 'src/common/crypto/field-crypto';
import { dataSourceOptions } from 'src/database/data-source';

/**
 * Reescribe los campos cifrados con la clave activa.
 *
 * Es la segunda mitad de una rotación. La primera —añadir la clave nueva al
 * llavero y marcarla activa— basta para que lo que se escriba a partir de ese
 * momento use la nueva; esto reescribe lo anterior, que es lo que permite
 * *retirar* la clave vieja después. Mientras quede un solo valor cifrado con
 * ella, sacarla del llavero convierte ese valor en basura permanente.
 *
 * **No toca los índices ciegos.** El motor de coincidencias compara el hash del
 * reporte con el del avistamiento para decidir si son la misma persona; si un
 * índice se recalculara con otra clave, dos reportes de la misma persona
 * dejarían de reconocerse. Los índices tienen su propia clave, estable, y
 * cambiarla es otra operación distinta.
 *
 * Uso:
 *   npm run crypto:rotate            # muestra qué haría, sin escribir
 *   npm run crypto:rotate -- --aplicar
 */

/** Columnas cifradas, por tabla. Si añades una, va aquí. */
const CIFRADAS: { tabla: string; columnas: string[] }[] = [
  {
    tabla: 'missing_person_reports',
    columnas: ['documentNumber', 'reporterPhone', 'reporterEmail'],
  },
  {
    tabla: 'sighting_reports',
    columnas: ['documentNumber', 'reporterPhone'],
  },
];

/** Filas por transacción. Suficientemente pequeño para no bloquear la tabla. */
const LOTE = 200;

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');

  resetKeyringCache();
  const { ids, activeId } = keyringInfo();

  console.log(`Llavero:      ${ids.join(', ')}`);
  console.log(`Clave activa: ${activeId}`);
  console.log(aplicar ? 'Modo:         APLICANDO CAMBIOS\n' : 'Modo:         simulación (usa --aplicar para escribir)\n');

  if (ids.length === 1 && aplicar) {
    console.log(
      'Solo hay una clave en el llavero: no hay nada que rotar.\n' +
        'Añade la nueva a FIELD_ENCRYPTION_KEYS y marca FIELD_ENCRYPTION_ACTIVE antes de aplicar.',
    );
    return;
  }

  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();

  let totalPendientes = 0;
  let totalReescritas = 0;
  let totalIlegibles = 0;

  try {
    for (const { tabla, columnas } of CIFRADAS) {
      const lista = columnas.map((c) => `"${c}"`).join(', ');
      const filas = await dataSource.query<Record<string, string | null>[]>(
        `SELECT id, ${lista} FROM "${tabla}"`,
      );

      // Solo interesa lo que NO está ya con la clave activa.
      const pendientes = filas.filter((fila) =>
        columnas.some((c) => {
          const v = fila[c];
          return v !== null && keyIdOf(v) !== activeId;
        }),
      );

      totalPendientes += pendientes.length;
      console.log(
        `${tabla}: ${filas.length} filas, ${pendientes.length} por reescribir`,
      );

      if (!aplicar || pendientes.length === 0) continue;

      for (let i = 0; i < pendientes.length; i += LOTE) {
        const lote = pendientes.slice(i, i + LOTE);

        // Una transacción por lote: si algo falla a mitad, ninguna fila queda
        // con unas columnas rotadas y otras no.
        await dataSource.transaction(async (manager) => {
          for (const fila of lote) {
            const sets: string[] = [];
            const params: unknown[] = [];

            for (const columna of columnas) {
              const actual = fila[columna];
              if (actual === null || keyIdOf(actual) === activeId) continue;

              let plano: string;
              try {
                plano = decryptField(actual);
              } catch (error) {
                // Se deja como está. Reescribirlo con la clave activa a partir
                // de un descifrado fallido escribiría basura encima de un dato
                // que quizá otra clave sí podría recuperar.
                totalIlegibles++;
                console.warn(
                  `  ! ${tabla}.${columna} de ${fila.id}: ${
                    error instanceof Error ? error.message : error
                  }`,
                );
                continue;
              }

              params.push(encryptField(plano));
              sets.push(`"${columna}" = $${params.length}`);
            }

            if (sets.length === 0) return;
            params.push(fila.id);
            await manager.query(
              `UPDATE "${tabla}" SET ${sets.join(', ')} WHERE id = $${params.length}`,
              params,
            );
            totalReescritas++;
          }
        });

        console.log(`  … ${Math.min(i + LOTE, pendientes.length)}/${pendientes.length}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }

  console.log('');
  if (!aplicar) {
    console.log(`${totalPendientes} fila(s) se reescribirían. Repite con --aplicar.`);
    return;
  }

  console.log(`${totalReescritas} fila(s) reescritas con la clave ${activeId}.`);

  if (totalIlegibles > 0) {
    console.log(
      `\n${totalIlegibles} valor(es) no se pudieron descifrar y quedaron intactos.\n` +
        'NO retires ninguna clave del llavero hasta resolverlos: si la que los\n' +
        'abre desaparece, esos datos se pierden para siempre.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    '\nTodo quedó con la clave activa. Ya puedes retirar las anteriores de\n' +
      'FIELD_ENCRYPTION_KEYS — guárdalas antes en un sitio seguro por si acaso.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
