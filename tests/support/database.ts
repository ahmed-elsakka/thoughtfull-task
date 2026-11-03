import { readdir, readFile } from 'node:fs/promises';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { PGlite } from '@electric-sql/pglite';
import type { SqlDatabase } from '@thoughtfull/db';

export async function createTestDatabase() {
  const database = new PGlite({ extensions: { btree_gist } });
  const migrations = new URL('../../packages/db/migrations/', import.meta.url);

  for (const name of (await readdir(migrations))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await database.exec(await readFile(new URL(name, migrations), 'utf8'));
  }

  const sql: SqlDatabase = {
    query: (query, values) => database.query(query, values),

    transaction: (run) =>
      database.transaction((tx) =>
        run({ query: (query, values) => tx.query(query, values) }),
      ),
  };

  return { database, sql };
}
