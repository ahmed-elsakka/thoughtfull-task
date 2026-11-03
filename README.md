# ThoughtFull session booking

Authentication, professional weekly availability, and member browsing of professionals and profiles are implemented. The member calendar and booking flow are also implemented. Session management and reminder delivery remain to be built.

## Run locally (PowerShell)

Requires Node.js 24, npm 11, and PostgreSQL 17 or Docker Compose.

```powershell
npm install
docker compose up -d db
$env:DATABASE_URL = 'postgresql://thoughtfull:thoughtfull_dev@localhost:5432/thoughtfull'
$env:APP_ORIGIN = 'http://127.0.0.1:5173'
npm run db:migrate
npm run dev
```

Open http://127.0.0.1:5173. Use that exact origin, or change APP_ORIGIN accordingly. Vite proxies /api to Fastify on port 3000. Signup signs in immediately. Refresh preserves login; logout revokes the session.

For existing PostgreSQL, skip Docker and point DATABASE_URL at your database. The API and Drizzle commands automatically load the repository-root .env when present. You can use the root .env instead of setting variables in PowerShell. The API checks its tables at startup. Example credentials are local-only.

If npm reports UNABLE_TO_VERIFY_LEAF_SIGNATURE on Windows, use `$env:NODE_OPTIONS = '--use-system-ca'` if Windows trusts the certificate. Do not disable TLS validation.

## Checks

```powershell
npm test
npm run typecheck
npm run build
npm run format:check
```

API tests apply the real migration and execute repository SQL with PGlite (embedded PostgreSQL). They cover roles, password hashing, timezone validation, uniqueness, session rotation/expiry/revocation, API restart, rollback, forged identity, CSRF, and rate limits. Migrations and API startup have also been verified against the configured local PostgreSQL service.

Browser tests start isolated API and web servers on ports 3001 and 5174, with ephemeral test data:

```powershell
npx playwright install chromium
npm run test:e2e
```

Alternatively set `$env:PLAYWRIGHT_CHANNEL = 'msedge'` for installed Edge. Tests exercise signup, reload, logout, wrong credentials, and successful login for both roles, plus working-hours validation, persistence, preview, and closing a day.

## Structure

- apps/web: React auth forms and account screen.
- apps/api: Fastify routes and session lookup.
- apps/worker: Reminder worker placeholder.
- packages/db: PostgreSQL pool, auth repository, schema, migrations.
- packages/shared: Browser-safe types and constants.
- tests/e2e and tests/support: Browser tests and test-only embedded database server.

Browser -> Fastify -> PostgreSQL. PGlite is test-only. SQL parameterizes user input. Shared packages build automatically before development and tests; rebuild them after source changes.

## API

| Method | Path             | Behavior                                                       |
| ------ | ---------------- | -------------------------------------------------------------- |
| POST   | /api/auth/signup | name, email, password, role, timezone; returns user and cookie |
| POST   | /api/auth/login  | email, password; returns user and rotates presented session    |
| GET    | /api/auth/me     | Public current user or 401                                     |
| POST   | /api/auth/logout | Revokes session, clears cookie, returns 204                    |
| GET    | /api/health      | Process liveness                                               |

Writes require Origin matching APP_ORIGIN and X-Requested-With: ThoughtFull. The frontend supplies both. Unknown fields, including user IDs, are rejected on signup/login. Emails are lowercase; signup passwords are 12-128 characters. Named IANA timezones are validated and canonicalized.

Production requires NODE_ENV=production, an exact HTTPS APP_ORIGIN, and same-origin routing of /api. Cookies are HttpOnly, SameSite=Lax, and Secure in production. Sessions last seven days.

Run npm run db:generate after schema edits and npm run db:migrate to apply migrations with DATABASE_URL set. Compose starts PostgreSQL only; the worker is still a placeholder. See DECISIONS.md for limitations.

Verification in the development environment: build, type checks, formatting, and all 77 unit/API/SQL tests passed. Browser specs were added, but Edge exited before executing them due to sandbox access errors; the fallback Chromium download stalled. Run the browser tests on a host that permits Playwright browser processes. Production dependency audit reported zero vulnerabilities; Drizzle Kit has moderate development-only advisories.

## Professional availability

Log in as a professional and scroll to **Weekly working hours**. Enable a day, enter opening/closing times, and save. All times use the professional's signup timezone; the backend derives both identity and timezone from the session. The editor starts with every day closed. Members cannot read or change this settings endpoint.

- GET /api/professional/availability: returns timezone and seven days.
- PUT /api/professional/availability: replaces the entire week with `{days: [{dayOfWeek: 1, startTime: "09:00", endTime: "17:00"}, ...]}`. Include weekdays 1-7 once each; closed days have both times null. User IDs and timezone overrides are rejected.
- GET /api/professional/availability/slots: returns generated UTC start/end instants and a professional-local date window. The UI displays these in the professional's timezone.

Sessions are 50 minutes, starting every 60 minutes anchored to that day's opening time (09:15 produces 09:15, 10:15, and so on). The entire session must fit before closing. Each open day must have at least 50 minutes, within 00:00-23:59 on one day. The preview covers today and the following 27 local calendar dates and excludes starts at or before now. Missing/repeated DST times and offset-crossing sessions with a duration other than 50 elapsed minutes are skipped. See DECISIONS.md for the policy.

The preview uses saved hours; unsaved edits are marked. Saving refreshes it; it also refreshes once a minute. The professional preview now hides confirmed bookings. The member profile has a calendar in the member timezone that also hides their own conflicting sessions.

Apply the new migration with `npm run db:migrate`, then restart `npm run dev`. If Vite reports ECONNREFUSED on port 3000, the API is not listening: inspect the API terminal for a missing DATABASE_URL, unreachable PostgreSQL, unapplied migration, or a different configured PORT. The dev proxy expects port 3000.

## Find a professional

Log in as a member to see **Find a professional** below the account details. The directory lists registered professional accounts alphabetically, 20 at a time. Open **View profile** to see the name, timezone, and standard 50-minute session duration. Profiles have hash URLs that survive refresh and support browser Back/Forward. No credentials, emails, sessions, or other members are exposed.

- GET /api/professionals?page=1 returns `{professionals: [{id, name, timezone}], nextPage}`.
- GET /api/professionals/:id returns `{professional: {id, name, timezone}}` or 404.

Both endpoints require a member session. Accounts with no saved working hours still appear; availability is not a qualification for directory inclusion. If no professionals have registered, the UI shows an empty state. Create a professional through the existing signup flow to populate the directory. No fabricated biographies, credentials, or ratings are added. No new migration is needed. Open a profile to use the member calendar and booking confirmation flow.

## Calendar and booking

As a member, open a professional profile. Choose a date and time, review the confirmation details, and press Confirm booking. The calendar covers today and the next 27 local dates in your signup timezone. It refreshes every 30 seconds and after booking. The server rechecks every selection, including stale slots.

- GET /api/professionals/:id/slots returns only free UTC start/end instants, the member timezone, and local calendar bounds.
- POST /api/bookings accepts professionalId, startsAt, and a requestId UUID reused when retrying the same confirmation. The backend supplies member identity and duration.
- GET /api/bookings/:id returns the authenticated member's own receipt, or 404.

PostgreSQL exclusion constraints prevent overlapping confirmed sessions for both participants, including simultaneous requests. Booking rereads working hours under participant locks. Starts in the past, outside working hours, off the slot grid, or outside the four-week window are rejected. The booking and pending 24-hour/1-hour reminder rows for both people commit together. Reminder delivery is not implemented yet.

Run npm run db:migrate for the booking tables and btree_gist constraints. Installing the bundled PostgreSQL extension requires sufficient database permissions. The migration has been applied to the configured local database.

Run npm test for all unit/API/SQL tests. Run npm run test:postgres for four real concurrent-connection checks against a local PostgreSQL server. This requires CREATE DATABASE permission and uses a uniquely named disposable database, which is cleaned up afterwards; application data is untouched. Checks cover same-slot competition, overlapping sessions across professionals, simultaneous retries, and database constraint enforcement on direct SQL writes.

The booking browser scenario is included in npm run test:e2e but remains unverified under the current sandbox browser-launch restriction. My sessions, cancellation/rescheduling, and notification delivery remain separate upcoming features.
