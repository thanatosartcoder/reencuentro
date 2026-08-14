import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { ingestHdxDamage } from 'src/modules/ingest/hdx-damage.ingester';

/**
 * Ejecuta a mano la ingesta de daño de HDX.
 *
 * La lógica vive en `modules/ingest/hdx-damage.ingester.ts`, que es la misma que
 * usa el cron diario: si estuviera duplicada aquí, una corrección aplicada en un
 * sitio y no en el otro produciría cargas distintas según quién las dispare.
 *
 * Uso:  npm run ingest:hdx  [-- --force]
 */
async function main(): Promise<void> {
  const force = process.argv.includes('--force');

  console.log('Ingiriendo evaluaciones de daño desde HDX…');
  await AppDataSource.initialize();

  try {
    const result = await ingestHdxDamage(AppDataSource, { force });
    console.log(`\nListo: ${result.inserted} edificaciones dañadas cargadas.`);
    console.log(
      'Recuerda: son estimaciones de un modelo sobre imagen satelital, no inspecciones.',
    );
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error('La ingesta falló:', error);
  process.exit(1);
});
