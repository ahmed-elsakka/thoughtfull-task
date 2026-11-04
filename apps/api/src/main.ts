import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createDatabase } from '@thoughtfull/db';
import { buildApp } from './app.js';

const envFile = new URL('../../../.env', import.meta.url);

if (existsSync(envFile)) loadEnvFile(envFile);

if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required. See .env.example.');

const production = process.env.NODE_ENV === 'production';
const origin =
  process.env.APP_ORIGIN ?? (production ? '' : 'http://127.0.0.1:5173');

if (
  !origin ||
  new URL(origin).origin !== origin ||
  (production && !origin.startsWith('https://'))
)
  throw new Error('APP_ORIGIN must be an exact origin (HTTPS in production).');

const database = createDatabase(process.env.DATABASE_URL);
const app = buildApp({
  auth: { store: database.authStore, origin, secureCookies: production },
  availability: database.availabilityStore,
  professionals: database.professionalStore,
  bookings: database.bookingStore,
  notifications: database.notificationStore,
});

app.addHook('onClose', async () => {
  await database.pool.end();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    await app.close();
  });

try {
  await database.pool.query('SELECT token_hash FROM auth_sessions LIMIT 0');
  await database.pool.query('SELECT id FROM bookings LIMIT 0');
  await database.pool.query('SELECT id FROM notifications LIMIT 0');
  await database.pool.query(
    'SELECT professional_id FROM professional_availability LIMIT 0',
  );

  await app.listen({
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 3000),
  });
} catch (error) {
  app.log.error(error);

  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '42P01'
  ) {
    app.log.error(
      'Database tables are missing. Run npm run db:migrate from the repository root, then restart the API.',
    );
  }
  await app.close();
  process.exitCode = 1;
}
