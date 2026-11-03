# Decisions and planned implementation

## Scaffold decisions

- npm workspaces: one repository and lockfile without another build orchestrator.
- Fastify and TypeScript for the API; React and Vite for the frontend.
- PostgreSQL with Drizzle; explicit SQL migrations for constraints the ORM cannot express.
- Separate worker entry point, sharing the database package. No external queue service initially.

## Booking and reminder roadmap

- Prevent overlaps for both professionals and members with PostgreSQL exclusion constraints on active bookings using half-open time ranges.
- Reschedule and update pending reminders in one transaction; failures preserve the original session.
- Store booking instants as timestamptz; reuse the implemented local-time availability rules below.
- Revalidate generated availability and booking conflicts inside the future booking transaction.
- Persist reminders; insert notifications and mark reminders delivered atomically, with a unique reminder reference. Coordinate booking changes and delivery using consistent locks.
- Server-side session authentication and ownership checks on every protected endpoint.

## Follow-up work

Implement My sessions, cancellation/rescheduling, notifications, and worker. Authentication, professional availability, and member professional browsing are implemented. Add booking boundary, concurrency, DST, privacy, and reminder restart tests. Add full-app Compose and CI after the core flow works.

## Production considerations to address

Before production: provision secrets and TLS termination, review the authentication controls below, add audit trails without sensitive payloads, backups and restore testing, monitoring, data retention/access policies, and applicable healthcare/privacy review.

## Implemented authentication

Argon2id uses independent salts, 19 MiB memory, two iterations, and one lane. Passwords are 12-128 characters. Opaque 256-bit random session tokens live in HttpOnly cookies; PostgreSQL stores only SHA-256 token hashes. Sessions expire after seven days, survive API restarts, rotate at login, and are revoked at logout. Expired rows are denied immediately; periodic cleanup is future housekeeping.

User and initial session creation share a transaction. A unique normalized email constraint handles races. Public responses whitelist fields. The backend validates role and canonicalizes IANA timezones. Professional verification is outside this assignment.

Writes require the configured Origin and a custom header alongside SameSite cookies. Production requires HTTPS and Secure cookies. Login/signup limits are per-IP, per-route, and per-process (10/minute). Multi-instance deployment needs a shared limiter and trusted proxy configuration. Unknown accounts use dummy password verification and the same error as wrong passwords.

The repository uses parameterized SQL with explicit transactions; Drizzle owns schema/migrations. PGlite tests execute this actual SQL. Migration application and API startup were verified against the configured local PostgreSQL service. React Query gets identity from /api/auth/me and clears account data on logout.

Future protected features must register within the auth plugin scope or move session resolution to a common ancestor. Never trust client-provided user IDs for authentication.

Drizzle ORM and Vitest were updated after audit findings. Remaining moderate advisories affect Drizzle Kit development dependencies. Do not expose development tools publicly.

## Implemented professional availability

Requirement source: ThoughtFull_TakeHome_Booking_Task.pdf, page 1, Professional availability: weekly hours for each weekday in the professional's own timezone, with slots generated from those hours. Related requirements are 50-minute sessions, persistent data, backend access control, and tests around slot generation/timezones. The four-week professional preview prepares for, but does not implement, the separate member calendar/booking feature.

- One interval per weekday, or closed. New accounts start closed; we never invent working hours without the professional saving them. Split shifts, overnight intervals, and date-specific holidays are not implemented. Hours use minute precision; closing must be later on the same day and permit at least one 50-minute session.
- Slot starts are anchored to opening time at 60-minute wall-clock intervals. A 09:00-17:00 day gives eight sessions, ending at 16:50. A 09:15-11:05 day gives two sessions, ending exactly at closing. The ten-minute gap separates successive sessions; no extra gap is required after the last session.
- Store recurring weekdays and local minutes since midnight, linked to the professional. The user's IANA timezone is the source of truth. Generate each date separately so UTC offsets can change while local working hours stay stable.
- Preview includes the current local date plus 27 following dates. Starts at or before the injected server clock are excluded. Return UTC instants; display in the professional's timezone. No pre-generated slot rows are persisted, so editing hours immediately changes future generated slots.
- DST policy: use Temporal disambiguation=reject for both endpoints. Skip slots with nonexistent or repeated endpoints and slots crossing an offset change whose elapsed duration is not exactly 50 minutes. This conservatively omits ambiguous appointments rather than shifting them silently or offering duplicate local labels. Unit tests include spring/fall transitions and a 30-minute Lord Howe transition.
- Every availability route inherits the session/CSRF hooks. Professional-only checks run in an isolated child plugin so member authentication endpoints continue to work. Only the authenticated user's ID is passed to persistence; clients cannot supply an owner/timezone override.
- Replacing a week locks the professional's user row, deletes prior rows, and inserts open days in one transaction. A failed insert restores the previous week. Concurrent saves serialize; the last completed replacement wins, with no merged/partial week. Primary key and CHECK constraints enforce one interval per day and valid ranges.
- Booking now subtracts confirmed sessions and rechecks hours under participant locks. Working-hour edits retain existing appointments. Available-slot responses contain no booked-client identities.
- Root .env loading is now automatic for API startup and Drizzle commands. Missing tables produce a migration instruction; the API deliberately does not auto-migrate on startup.

## Find a professional

The brief requires a member to see a list of professionals and open a profile. Reuse registered users with role=professional, selecting only id, name, and timezone. The profile displays these fields and the shared session duration. Biography, specialties, ratings, and verification are not collected by signup, so this feature does not invent them or imply clinical verification.

The directory includes professionals with no working hours; they are still professionals. Member-only checks run in their own plugin under session authentication. A member ID and a nonexistent ID both return the same 404. SQL projection and Fastify response schemas whitelist fields so future repository changes do not accidentally expose emails, password hashes, or sessions.

Use 20 results per page, ordered case-insensitively by name then UUID for deterministic ties. Fetch one extra row to determine nextPage. Offset pagination is adequate for this small directory; concurrent registration/deletion can shift pages, so a larger deployment should use cursors. Validate page and UUID parameters and parameterize database queries.

Profiles use hash navigation to preserve refresh and browser history without adding a router dependency for this small feature. API state lives in React Query, partitioned by the signed-in member. Empty, loading, not-found, and retry states are provided. The profile now includes the member calendar and booking flow described below.

## Implemented calendar and booking

The brief requires four weeks of slots in the member timezone, explicit confirmation, and booked slots disappearing. Associated requirements are no past sessions, no overlaps for either participant, persistence, and privacy. The calendar covers 28 local dates rather than a fixed 672 hours. Convert member-local boundaries into instants and enumerate all intersecting professional-local dates, including date-line edges.

Store booking timestamps as timestamptz with a 50-minute duration CHECK. Two partial GiST exclusion constraints protect confirmed sessions: professional plus time range, and member plus time range. Both use half-open intervals, allowing adjacency. These constraints are explicit additions to the generated migration because Drizzle does not express them; preserve them in future migrations.

Transactions lock participant user rows in UUID order, coordinating with availability edits and avoiding inconsistent lock order. After obtaining locks, reread roles, timezones, and hours; generate valid slots; check server time again immediately before insertion. Database constraints protect other code paths and direct SQL writes. Changing hours does not cancel existing bookings.

A member-scoped request UUID makes retries idempotent. Repeating the key returns the existing booking; using it for another professional/start gets 409. The UI preserves the key through retries and disables confirmation during submission. Calendar responses exclude both professional conflicts and the requesting member's overlaps, revealing only free instants. Booking receipt reads enforce ownership.

The same transaction inserts durable reminders for both people at 24 hours and one hour before start. Skip reminder times strictly before acceptance; retain one due exactly now. Unique booking/recipient/offset rows prevent duplicate scheduling. Delivery and cancellation/reschedule updates remain future work.

PGlite tests exercise the actual SQL migration and btree_gist constraints. Independent connections to a disposable local PostgreSQL database verify simultaneous claims, member overlaps, idempotent retries, and direct SQL enforcement. The calendar UI pins the chosen date after confirmation so removing the last slot does not silently jump to another date.
