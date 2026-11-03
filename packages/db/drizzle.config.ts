import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { defineConfig } from 'drizzle-kit';

const envFile = new URL('../../.env', import.meta.url);

if (existsSync(envFile)) loadEnvFile(envFile);

const url = process.env.DATABASE_URL;

if (!url) throw new Error('Set DATABASE_URL before running database commands.');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url },
});
