# ThoughtFull session booking

Implemented: authentication, professional availability, blocked dates (holidays), professional browsing, calendar booking, My sessions, cancellation/rescheduling, and in-app reminders delivered by a PostgreSQL-backed worker.

## Run everything with Docker Compose

Requires only Docker with Compose.

```powershell
docker compose up --build
```

Open http://127.0.0.1:8080 (use this exact address, not `localhost`, because the API checks the request origin). Compose starts PostgreSQL, applies pending migrations once, then starts the API, the reminder worker, and an nginx container that serves the web app and proxies /api to the API. The first build takes a few minutes. Stop with Ctrl+C, and `docker compose down` removes the containers while keeping the database volume. `docker compose down -v` also deletes the data.

The credentials in compose.yaml are local-only examples. Compose runs the API outside production mode because production requires HTTPS cookies; see DECISIONS.md for what changes for a real deployment. To use another address, set `DOCKER_APP_ORIGIN` before starting, for example `$env:DOCKER_APP_ORIGIN = 'http://127.0.0.1:9000'`, and change the published port to match. The root `.env` (used by the npm workflow, with `APP_ORIGIN` on port 5173) does not affect Docker. If you change the origin and still see "Request origin is not allowed", rebuild with `docker compose up --build` and clear any leftover `$env:DOCKER_APP_ORIGIN`.

## Run locally with npm (PowerShell)

Requires Node.js 24, npm 11, and PostgreSQL 17 or Docker Compose. This is the faster loop while editing code.

```powershell
npm install
docker compose up -d db
$env:DATABASE_URL = 'postgresql://thoughtfull:thoughtfull_dev@localhost:5432/thoughtfull'
$env:APP_ORIGIN = 'http://127.0.0.1:5173'
npm run db:migrate
npm run dev:all
```

`npm run dev:all` builds the shared, db, API, and worker packages, then runs the compiled API and reminder worker alongside the Vite dev server. The worker must be running for reminders to be delivered as notifications. Compiled services do not restart on code changes: press Ctrl+C and run `npm run dev:all` again after editing API or worker code. The web app still hot-reloads.

Open http://127.0.0.1:5173. Use that exact origin, or change APP_ORIGIN accordingly. Vite proxies /api to Fastify on port 3000. Signup signs in immediately. Refresh preserves login; logout revokes the session.

For existing PostgreSQL, skip Docker and point DATABASE_URL at your database. The API, worker, and Drizzle commands automatically load the repository-root .env when present. You can use the root .env instead of setting variables in PowerShell. The API checks its tables at startup. Example credentials are local-only.

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

- apps/web: React authentication, booking/session management, and polling notification UI.
- apps/api: Fastify routes, authentication, and ownership enforcement.
- apps/worker: Durable reminder processing every five seconds.
- packages/db: PostgreSQL repositories, transactions, schema, and migrations.
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

Run npm run db:generate after schema edits and npm run db:migrate to apply migrations with DATABASE_URL set. `docker compose up --build` runs the whole app; `docker compose up -d db` starts only PostgreSQL for the npm workflow. See DECISIONS.md for limitations.

Verification in the development environment: build, type checks, formatting, and all 77 unit/API/SQL tests passed. Browser specs were added, but Edge exited before executing them due to sandbox access errors; the fallback Chromium download stalled. Run the browser tests on a host that permits Playwright browser processes. Production dependency audit reported zero vulnerabilities; Drizzle Kit has moderate development-only advisories.

## Minimum booking notice

Members cannot book or reschedule onto a session that starts less than 2 hours from now. A start exactly 2 hours ahead is still allowed. The rule is the `MIN_BOOKING_NOTICE_MINUTES` constant in packages/shared/src/constants.ts. Slots inside the window are hidden from the member calendar, the reschedule picker and the professional's slot preview. The server also rejects a direct request with 400 and "Sessions must be booked at least 2 hours ahead." The time is measured in elapsed hours, so daylight-saving changes do not move it. The notice does not apply to cancelling, and a retried booking request that was already accepted is replayed rather than rejected. `npm test` covers the boundary, rescheduling, replays, and the calendar.

## Blocked dates

Log in as a professional and use **Blocked dates** below the working hours. Pick a date (today up to 365 days ahead) and choose **Block date**. Members then see no slots on that date, and the slot preview updates immediately. **Unblock** restores the date. Dates are calendar dates in the professional's own timezone. Blocking does not cancel sessions that are already booked: they stay confirmed and are flagged in the list so you can cancel them from My sessions. Apply migration 0004 with `npm run db:migrate` first.

- GET /api/professional/blocked-dates returns `{timezone, dates: [{date, confirmedSessions}]}`.
- POST /api/professional/blocked-dates with `{"date": "2026-12-25"}` blocks a date (201, or 200 if already blocked).
- DELETE /api/professional/blocked-dates/2026-12-25 unblocks it (200, idempotent).

All three require a logged-in professional, and writes require the CSRF headers. `npm test` covers slot removal, professional-local dates, validation, privacy, restart persistence, and booking/reschedule rejection.

## Professional availability

Log in as a professional and scroll to **Weekly working hours**. Enable a day, enter opening/closing times, and save. All times use the professional's signup timezone; the backend derives both identity and timezone from the session. The editor starts with every day closed. Members cannot read or change this settings endpoint.

- GET /api/professional/availability: returns timezone and seven days.
- PUT /api/professional/availability: replaces the entire week with `{days: [{dayOfWeek: 1, startTime: "09:00", endTime: "17:00"}, ...]}`. Include weekdays 1-7 once each; closed days have both times null. User IDs and timezone overrides are rejected.
- GET /api/professional/availability/slots: returns generated UTC start/end instants and a professional-local date window. The UI displays these in the professional's timezone.

Sessions are 50 minutes, starting every 60 minutes anchored to that day's opening time (09:15 produces 09:15, 10:15, and so on). The entire session must fit before closing. Each open day must have at least 50 minutes, within 00:00-23:59 on one day. The preview covers today and the following 27 local calendar dates and excludes starts at or before now. Missing/repeated DST times and offset-crossing sessions with a duration other than 50 elapsed minutes are skipped. See DECISIONS.md for the policy.

The preview uses saved hours; unsaved edits are marked. Saving refreshes it; it also refreshes once a minute. The professional preview now hides confirmed bookings. The member profile has a calendar in the member timezone that also hides their own conflicting sessions.

Apply the new migration with `npm run db:migrate`, then restart `npm run dev:all`. If Vite reports ECONNREFUSED on port 3000, the API is not listening: inspect the API terminal for a missing DATABASE_URL, unreachable PostgreSQL, unapplied migration, or a different configured PORT. The dev proxy expects port 3000.

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

PostgreSQL exclusion constraints prevent overlapping confirmed sessions for both participants, including simultaneous requests. Booking rereads working hours under participant locks. Starts in the past, outside working hours, off the slot grid, or outside the four-week window are rejected. The booking and pending 24-hour/1-hour reminder rows for both people commit together. The worker delivers due reminders as in-app notifications.

Run npm run db:migrate for the booking tables and btree_gist constraints. Installing the bundled PostgreSQL extension requires sufficient database permissions. The migration has been applied to the configured local database.

Run npm test for all unit/API/SQL tests. Run npm run test:postgres for ten real concurrent-connection checks against a local PostgreSQL server. This requires CREATE DATABASE permission and uses a uniquely named disposable database, which is cleaned up afterwards; application data is untouched. Checks cover same-slot competition, overlapping sessions across professionals, simultaneous retries, database constraint enforcement on direct SQL writes, and races involving rescheduling and cancellation.

The booking browser scenario is included in npm run test:e2e but remains unverified under the current sandbox startup/browser-launch restrictions. The notification polling browser test uses mocked responses to exercise polling, unread updates, error recovery, and logout independently of worker timing.

## My sessions

Both roles see **My sessions** below the member directory or above professional availability. Members can switch between Upcoming and Past; professionals see their upcoming schedule with member names. Dates and times use the signed-in user's timezone. Upcoming includes in-progress confirmed sessions until their end time; Past shows ended sessions, most recent first. Cancelled future sessions are excluded from Upcoming.

GET /api/sessions?period=upcoming&page=1 returns `{sessions: [{id, counterpartName, startsAt, endsAt, status}], nextPage}`. The period defaults to upcoming and the page to 1. Only members can request past. The API derives identity and role from the authenticated session and rejects client identity overrides. Results are ordered and paginated in groups of 20. No new migration is required.

The list refreshes every 30 seconds, on window focus, and immediately after a successful booking. Loading, empty, retry, and pagination states are included. Run `npm test` for ownership, privacy, time-boundary, ordering, pagination, and request-validation checks.

## Cancel and reschedule

Use the actions on each session in **My sessions**. Members can cancel or reschedule at least 24 elapsed hours before the original start, including exactly 24 hours. Inside that window the controls are disabled with an explanation, and the API independently enforces the rule using server time. Professionals can cancel their own sessions at any time. Only members reschedule; the professional stays the same.

Reschedule opens available dates and times in the member timezone, with a review before confirmation. The old session stays booked until the move succeeds. Changing to an available future slot within the next four weeks is allowed, even if that new slot is less than 24 hours away; subsequent member changes are then blocked by the same notice rule.

- GET /api/sessions/:id/reschedule-slots returns free alternatives for an owned member session, excluding the current start.
- POST /api/sessions/:id/cancel accepts `{expectedStartsAt}`.
- POST /api/sessions/:id/reschedule accepts `{expectedStartsAt, startsAt}`.

Use the original UTC start from the list as expectedStartsAt. A stale change returns 409 so another tab cannot accidentally cancel or overwrite a moved session. Cancellation retries are safe; after an uncertain reschedule response, refresh the session list before submitting again. The original booking ID stays the same. No new migration is needed.

Cancellation deletes pending reminders. Rescheduling replaces the old reminder records with a new set for both participants, skipping times already passed. These updates share the booking transaction, so a conflict or reminder failure restores the original session and reminders. Delivered notifications remain as history when a session changes.

`npm test` covers deadlines, access control, stale requests, overlap rollback, and reminder replacement. `npm run test:postgres` now includes ten concurrency checks in a disposable database. If Windows prevents tsx from starting, after building shared/db packages use `node tests/integration/booking-concurrency.ts` with Node 24.

## Reminders and notifications

Apply migration 0003 with `npm run db:migrate`, then start `npm run dev:all` from the root. It starts the compiled API, the Vite web app, and the reminder worker. The migration has been applied to the configured local database.

`npm run dev` is an alternative that runs `tsx watch` for the API and worker, which restarts them on code changes. On some Windows machines two `tsx watch` processes started together print nothing and never listen, so `dev:all` is the supported default. If you need watch mode, run `npm run dev -w @thoughtfull/api`, `npm run dev -w @thoughtfull/worker`, and `npm run dev -w @thoughtfull/web` in three separate terminals.

Troubleshooting: if the Notifications panel shows `Route GET:/api/notifications not found`, the API process is stale, for example started before the notifications wiring or before `@thoughtfull/db` was rebuilt. Stop all Node processes, then run `npm run dev:all` again.

The worker checks PostgreSQL immediately on startup and every five seconds after each pass. It processes up to 50 bookings per pass, retries transient failures on the next pass, and finishes its current pass before shutting down. Pending reminders survive restarts. Overdue reminders are delivered on recovery, including after the session start if the booking remains confirmed; the UI shows the scheduled session time rather than claiming it is still in the future.

Each due reminder produces one notification for its recipient. The notification insert and delivered timestamp commit together. A unique source reminder ID prevents duplicates. Worker and session changes acquire participant locks in UUID order, then the booking, then reminders; this also accounts for implicit locks from notification foreign keys. Cancellation removes pending reminders. Rescheduling replaces pending reminder scheduling while preserving already-delivered notification snapshots.

Both roles see Notifications after their account details. The UI polls every 15 seconds while the tab is active, refetches on focus/reconnection, stops polling on logout, and supports read state and 20-item pages. Unread count covers all pages. Existing notifications remain visible when a refresh fails. In normal operation, delivery plus UI polling adds about 20 seconds of latency, plus processing/network time; backlog or downtime can increase it.

- GET /api/notifications?page=1 returns `{notifications, unreadCount, nextPage}` for the authenticated recipient only.
- PATCH /api/notifications/:id/read with an empty JSON object marks an owned notification read, idempotently. Writes require the existing CSRF headers. Other users' IDs return 404.

Run `npm test` for delivery boundaries, restart recovery, rollback, duplicate prevention, ownership, pagination, read state, backlog draining across multiple passes, professional cancellation inside 24 hours, daylight-saving reminder times, and worker retry/shutdown. The PostgreSQL suite also tests concurrent workers and races with cancellation/rescheduling. `tests/e2e/notifications.spec.ts` covers browser polling and read state; browser execution may require running outside the current Windows sandbox.
