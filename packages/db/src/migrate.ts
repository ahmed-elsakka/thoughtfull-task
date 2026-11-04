import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './index.js';

const envFile = new URL('../../../.env', import.meta.url);

if (existsSync(envFile)) loadEnvFile(envFile);
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required. See .env.example.');

const database = createDatabase(process.env.DATABASE_URL);

try {
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
  console.info('Database migrations are up to date.');
} catch (error) {
  console.error('Database migration failed.', error);
  process.exitCode = 1;
} finally {
  await database.pool.end();
}
