import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createDatabase } from '@thoughtfull/db';
import { runReminderWorker } from './reminders.js';

const envFile = new URL('../../../.env', import.meta.url);

if (existsSync(envFile)) loadEnvFile(envFile);
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required. See .env.example.');

const database = createDatabase(process.env.DATABASE_URL);
const shutdown = new AbortController();

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => shutdown.abort());

try {
  await database.pool.query('SELECT id FROM notifications LIMIT 0');
  await database.pool.query(
    'SELECT delivered_at FROM booking_reminders LIMIT 0',
  );
  console.info(
    'Reminder worker running: checking for due reminders every 5 seconds.',
  );
  await runReminderWorker(database.notificationStore, shutdown.signal);
} catch (error) {
  console.error(
    'Reminder worker failed to start. Check PostgreSQL and run npm run db:migrate.',
    error,
  );
  process.exitCode = 1;
} finally {
  await database.pool.end();
}
