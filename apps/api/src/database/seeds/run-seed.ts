import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { runEarthquakeSeed } from './earthquake-2026.seed';

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await runEarthquakeSeed(AppDataSource);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error('El seed falló:', error);
  process.exit(1);
});
