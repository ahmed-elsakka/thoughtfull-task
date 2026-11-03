import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return { db: drizzle(pool), pool };
}
