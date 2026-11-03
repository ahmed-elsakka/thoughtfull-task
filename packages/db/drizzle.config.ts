import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL before running database commands.');
export default defineConfig({ dialect: 'postgresql', schema: './src/schema/index.ts', out: './migrations', dbCredentials: { url } });
