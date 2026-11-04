## Prerequisites

- **Run the app with Docker:** Docker with Compose.
- **Run it for development, and run the tests:** Node.js 24 and npm 11. For development you also need PostgreSQL 17, which `docker compose up -d db` provides.

## Run the app

```powershell
docker compose up --build
```

Open http://127.0.0.1:8080 (use this exact address, not `localhost`, because the API checks the request origin). Compose starts PostgreSQL, applies the migrations once, then starts the API, the reminder worker, and an nginx container that serves the web app and proxies `/api` to the API. The first build takes a few minutes.

Stop with Ctrl+C. `docker compose down` removes the containers and keeps the data; `docker compose down -v` also deletes the data.

### Development setup

```powershell
npm install
docker compose up -d db
$env:DATABASE_URL = 'postgresql://thoughtfull:thoughtfull_dev@localhost:5432/thoughtfull'
$env:APP_ORIGIN = 'http://127.0.0.1:5173'
npm run db:migrate
npm run dev:all
```

Open http://127.0.0.1:5173. `dev:all` builds and runs the API and the reminder worker next to the Vite dev server. Reminders are only delivered while the worker is running. API and worker code changes need a restart (Ctrl+C, then `npm run dev:all`); the web app reloads on its own.

Alternatively, copy `.env.example` to `.env` instead of setting the variables in PowerShell.

## Run the tests

```powershell
npm install
npm test
```

This runs the unit, API and SQL tests. They use an embedded PostgreSQL (PGlite), so no database or Docker is needed.

Optional checks:

```powershell
npm run typecheck        # TypeScript
npm run test:postgres    # concurrency checks against a local PostgreSQL (needs DATABASE_URL and CREATE DATABASE permission)
npx playwright install chromium
npm run test:e2e         # browser tests on ports 3001 and 5174
```

## Architecture

![Application architecture: React UI features communicate with Fastify APIs over HTTP and JSON; the APIs read and write PostgreSQL. An independent reminder worker reads due reminders and saves notifications in the database.](docs/architecture.png)

- `apps/web`: React UI (header navigation, booking calendar, My Sessions, availability and blocked dates, notifications drop-down that polls every 15 seconds).
- `apps/api`: Fastify routes, cookie sessions, role checks and CSRF/origin checks.
- `apps/worker`: delivers due reminders exactly once from a PostgreSQL queue.
- `packages/db`: Drizzle schema, migrations, and the repositories that run the booking transactions. Exclusion constraints in PostgreSQL prevent double booking.
- `packages/shared`: types and rules shared by the UI and the server, such as slot generation and the 2-hour minimum booking notice.
- `tests`: browser tests and integration checks.

Design decisions and trade-offs are in [DECISIONS.md](DECISIONS.md). AI assistance is described in [AI_USAGE.md](AI_USAGE.md).
