# Decisions and planned implementation

## Scaffold decisions

- npm workspaces: one repository and lockfile without another build orchestrator.
- Fastify and TypeScript for the API; React and Vite for the frontend.
- PostgreSQL with Drizzle; explicit SQL migrations for constraints the ORM cannot express.
- Separate worker entry point, sharing the database package. No external queue service initially.

## Planned booking guarantees (not implemented)

- Prevent overlaps for both professionals and members with PostgreSQL exclusion constraints on active bookings using half-open time ranges.
- Reschedule and update pending reminders in one transaction; failures preserve the original session.
- Store weekly working hours as local times with an IANA timezone. Store booking instants as timestamptz. Define and test daylight-saving ambiguity handling.
- Proposed slot layout: 50-minute sessions starting every hour, fully within working hours. Record the anchoring rule when implemented.
- Persist reminders; insert notifications and mark reminders delivered atomically, with a unique reminder reference. Coordinate booking changes and delivery using consistent locks.
- Server-side session authentication and ownership checks on every protected endpoint.

## Follow-up work

Implement the schema, auth, availability, booking, cancellation/rescheduling, notifications, and worker. Add boundary, concurrency, DST, privacy, and restart tests. Add full-app Compose and CI after the core flow works.

## Production considerations to address

Secrets management, TLS, CSRF protection, session expiry, rate limiting, audit trails without sensitive payloads, backups and restore testing, monitoring, data retention/access policies, and applicable healthcare/privacy review. This scaffold does not implement these controls.
