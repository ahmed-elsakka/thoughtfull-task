// Test-only server: real authentication routes and SQL with an isolated embedded database.
import {
  createAuthStore,
  createAvailabilityStore,
  createProfessionalStore,
  createBookingStore,
} from '@thoughtfull/db';
import { buildApp } from '../../apps/api/src/app.js';
import { createTestDatabase } from './database.js';

const { database, sql } = await createTestDatabase();

const app = buildApp({
  logger: false,
  availability: createAvailabilityStore(sql),
  professionals: createProfessionalStore(sql),
  bookings: createBookingStore(sql),
  auth: {
    store: createAuthStore(sql),
    origin: 'http://127.0.0.1:5174',
    secureCookies: false,
  },
});

app.addHook('onClose', async () => {
  await database.close();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    await app.close();
  });
await app.listen({ host: '127.0.0.1', port: 3001 });
