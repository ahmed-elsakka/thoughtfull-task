import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { createAuthStore, type SqlDatabase } from './auth.js';

import { createAvailabilityStore } from './availability.js';

import { createProfessionalStore } from './professionals.js';

import { createBookingStore } from './bookings.js';

export * from './bookings.js';
export * from './professionals.js';
export * from './auth.js';
export * from './availability.js';

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  const sql: SqlDatabase = {
    query: (text, values) => pool.query(text, values),

    async transaction(run) {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const result = await run(client);
        await client.query('COMMIT');

        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };

  return {
    db: drizzle(pool),
    pool,
    authStore: createAuthStore(sql),
    availabilityStore: createAvailabilityStore(sql),
    professionalStore: createProfessionalStore(sql),
    bookingStore: createBookingStore(sql),
  };
}
