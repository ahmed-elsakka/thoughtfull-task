# AI usage

Codex assisted with stack selection and initial workspace scaffolding: package manifests, TypeScript configuration, a Fastify health endpoint and smoke test, frontend starter, database access factory, worker placeholder, and documentation.

Booking and reminder delivery remain unimplemented. Authentication and its schema are implemented as described below.

## Correction example to complete during implementation

Record a real example of AI output you corrected, rejected, or improved, including the original suggestion, your change, and why. This is intentionally not filled with an invented review example.

## Authentication implementation

Codex implemented authentication routes, SQL schema/migration, Argon2id hashing, persistent cookie sessions, frontend forms, and API/browser tests. Booking and reminder delivery remain unimplemented.

An actual correction: the first Fastify error handler assumed a typed error argument. TypeScript rejected property access on unknown; Codex added the FastifyError generic and verified the build. SQL tests use embedded PostgreSQL rather than mocked persistence, so uniqueness and transaction rollback are exercised.

These are agent-observed corrections, not a claim of personal developer review. Review all changes and add your own correction/rejection example before submission.

## Professional availability

Codex reread the supplied task and implemented the weekly editor, professional-only API, SQL migration, atomic replacement repository, timezone-aware slot generator, and tests. It recorded the one-interval/day, hourly-from-opening, 50-minute duration, and conservative DST policies in DECISIONS.md. PGlite integration tests exercise actual SQL; the migration was also applied to local PostgreSQL.

An implementation refinement: validating only that local endpoints exist does not guarantee 50 real minutes across a 30-minute DST jump. The generator additionally checks elapsed time, with a Lord Howe regression test. During this work, a user-reported Vite proxy error also exposed the missing .env loading; API and migration startup now load it, and the live health endpoint was verified.

## Find a professional

Codex implemented the member directory/profile UI, paginated professional queries, protected API endpoints, response-field whitelists, and tests. No fake professional biographies or credentials were generated. A defensive test supplies extra private repository fields and verifies the API serializer removes them. The browser scenario covers opening a profile, reload, return navigation, and browser history; browser execution remains limited by the sandbox launch restriction noted above.

## Calendar and booking

Codex implemented member-timezone calendars, confirmation UI, booking APIs, transactional persistence, exclusion constraints, retry idempotency, and reminder scheduling records. It added real PostgreSQL concurrency checks alongside embedded database tests.

Concrete refinement: 28 professional-local dates can omit valid slots at a member-local window boundary across the date line. Generation now enumerates all professional dates intersecting the member window, with a regression test. The selected UI date is pinned after confirmation so a newly empty date does not switch silently to another date.
