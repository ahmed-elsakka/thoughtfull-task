# ThoughtFull session booking

Initial TypeScript monorepo scaffold for the take-home assignment. The booking application is not implemented yet.

## Requirements and startup

- Node.js 24 and npm 11.
- Docker with Compose for PostgreSQL (not needed for the starter health endpoint).

```sh
npm install
npm run dev
```

Frontend: http://127.0.0.1:5173. API health: http://127.0.0.1:3000/api/health.
The Vite development proxy forwards `/api` to Fastify. The worker currently prints a scaffold message; it does not process reminders.

```sh
docker compose up -d db
npm run build
npm run typecheck
npm test
```

The root `.env.example` documents intended environment variables. Environment files are not automatically loaded: set variables in your shell before starting commands. For PowerShell:

```powershell
$env:DATABASE_URL = 'postgresql://thoughtfull:thoughtfull_dev@localhost:5432/thoughtfull'
```

Database commands are prepared (`npm run db:generate`, `npm run db:migrate`), but no application schema or migrations exist yet. Compose currently starts only PostgreSQL. All database credentials shown are local development values.

## Structure

```text
apps/
  web/                React, Vite, Tailwind, TanStack Query
  api/                Fastify; feature modules and plugins
  worker/             Reminder worker entry point and job folder
packages/
  db/                 Drizzle client, schema, SQL migrations
  shared/             Browser-safe types and constants
tests/
  integration/        Future database integration tests
  e2e/                Future Playwright scenarios
```

Flow: browser -> Fastify API -> PostgreSQL; reminder worker -> PostgreSQL.
Keep authentication, authorization, and booking decisions in the backend. Never import the database package into the frontend. Build shared packages before consuming them; after changing their source, rerun their build (or the root build).

`npm test` runs the starter API smoke test. Business-rule and integration tests remain to be implemented. `npm run test:e2e` is configured for future specs, with no browser tests yet. `npm run format` and `npm run format:check` handle formatting.
