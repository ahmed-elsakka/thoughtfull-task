# Decisions and planned implementation

## Scaffold decisions

- npm workspaces: one repository and lockfile without another build orchestrator.
- Fastify and TypeScript for the API; React and Vite for the frontend.
- PostgreSQL with Drizzle; explicit SQL migrations for constraints the ORM cannot express.
- Separate worker entry point, sharing the database package. No external queue service initially.

## Booking and reminder design

- Prevent overlaps for both professionals and members with PostgreSQL exclusion constraints on active bookings using half-open time ranges.
- Reschedule and update pending reminders in one transaction; failures preserve the original session.
- Store booking instants as timestamptz; reuse the implemented local-time availability rules below.
- Revalidate generated availability and booking conflicts inside the booking transaction.
- Persist reminders; insert notifications and mark reminders delivered atomically, with a unique reminder reference. Coordinate booking changes and delivery using consistent locks.
- Server-side session authentication and ownership checks on every protected endpoint.

## Minimum booking notice

Optional extra from the brief. The notice is a fixed 2 hours, kept as one shared constant rather than a per-professional setting, because the brief gives that figure as the example and a setting would add a table, validation and UI for no stated need. A start exactly 2 hours ahead is bookable; anything sooner is not. The rule lives in slot generation, so the member calendar, reschedule picker and professional preview agree, and `book` and `reschedule` check it again against the server clock after taking the locks, so a stale page or a hand-written request cannot bypass it. A request that is rejected for notice gets a specific message instead of the generic "no longer offered".

Two interactions are deliberate. A replayed booking request returns the original session even if its notice window has since passed, because the replay is checked before the notice. Cancelling is unaffected, since the 24-hour rule already governs it. Because every valid booking is at least 2 hours out, the 1-hour reminder is never skipped for a new booking, and only the 24-hour reminder can be missed. Known limitation: the notice is measured from the server clock when the request is processed, so a member who opens the confirmation screen at 1 hour 59 minutes before the start can be rejected at the last second.

## Blocked dates

Optional extra from the brief. A blocked date is a calendar date (`date` column) in the professional's own timezone, not an instant, because a holiday is a local day: blocking 25 December removes every slot that starts on that local date, whatever timezone the member views it in. Slot generation takes the blocked dates as an input, so the member calendar, booking, rescheduling and the professional preview all share one rule, and the booking and reschedule transactions re-read the blocked dates after locking the professional's user row. Blocking takes the same row lock, so a booking either commits before the block (and is reported on the blocked date) or sees the block and is rejected.

A professional can block a date that already has confirmed sessions, and that is allowed on purpose. The sessions are not cancelled and the members are not told anything, so the booking stays valid until someone acts on it. Silently cancelling a member's session would be worse than leaving it for the professional to handle, who can already cancel at any time. To make sure the professional notices, the blocked-date list shows a warning on each date with the number of confirmed sessions still booked (for example, "2 confirmed sessions are still booked on this date"). The warning is shown in the Blocked dates panel only. It is not an in-app notification record, and it is not repeated elsewhere, so a professional who ignores the panel can miss it. With more time I would confirm the choice at the moment of blocking, offer to cancel the affected sessions in one step, and send the affected members a notification. Dates must be today or later and within 365 days to keep the table small and avoid typos far in the future. Past blocked dates are not listed. Known limitation: there is no single "block a range" action, so a week-long holiday needs one entry per day.

## Follow-up work

The required application flows are implemented. `npm run dev:all` runs compiled services because two `tsx watch` processes started together hung on one Windows development machine; the cause was not investigated, and watch mode remains available per workspace. Add full-app Compose, CI, operational monitoring, database query timeouts, and broader browser coverage. Browser execution remains constrained by this Windows sandbox.

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

The same transaction inserts durable reminders for both people at 24 hours and one hour before start. Skip reminder times strictly before acceptance; retain one due exactly now. Unique booking/recipient/offset rows prevent duplicate scheduling. Delivery and cancellation/reschedule updates are described below.

PGlite tests exercise the actual SQL migration and btree_gist constraints. Independent connections to a disposable local PostgreSQL database verify simultaneous claims, member overlaps, idempotent retries, and direct SQL enforcement. The calendar UI pins the chosen date after confirmation so removing the last slot does not silently jump to another date.

## My sessions

Classify by end time: a confirmed session remains Upcoming while in progress, and becomes Past exactly at its end. This keeps an active session visible in the professional schedule. Upcoming is earliest first; Past is latest first, with UUID ties for deterministic pagination. Cancelled future bookings are excluded from Upcoming; ended cancelled bookings remain in member history with their status. No cancellation UI is introduced by this feature.

Use the server clock and compare UTC instants in SQL, then format both endpoints in the viewer's saved timezone in the UI. Identity and role come only from authentication. Join only the counterpart name and whitelist response fields; member emails and other private data never appear. Professionals have the upcoming view required by the brief. Offset pagination uses 20 rows and a lookahead; concurrent bookings or the passage of time can shift page boundaries, an acceptable tradeoff for this small app. Poll every 30 seconds and invalidate the member's list after booking.

## Cancel and reschedule

The member cutoff is 24 elapsed hours before the existing session, inclusive at exactly 24 hours. It uses instants, so DST and local calendar dates cannot change the deadline. Check after participant locks and again just before a reschedule update. A replacement must be a future offered slot in the member's four-week window, but needs no minimum notice. Professionals may cancel at any time; rescheduling is member-only and keeps the same professional.

Lock participant user rows in the same UUID order as booking/availability, then lock and reread the owned booking. Rescheduling updates that row; exclusion constraints validate both participants against other confirmed sessions. The slot picker excludes the owned booking from conflicts so shifting working hours can permit a replacement overlapping the old session. Everything commits together, including reminder replacement. No temporary cancellation or separate new booking is used.

The client sends expectedStartsAt as an optimistic precondition, never as identity or the authoritative deadline. A stale request gets 409 instead of overwriting another move. Repeated cancellation is a no-op. Reschedule retries with a stale precondition return 409; refreshing reveals the committed move without creating duplicate sessions. This simple timestamp precondition is not a full revision history (a move away and back to the same start is indistinguishable); use a version column and operation ledger for more advanced audit/idempotency needs.

Cancellation removes only undelivered reminders. Rescheduling retires the old reminder records and creates only still-relevant reminders for the new start. The worker coordinates on participant and booking locks; delivered notification snapshots persist independently of the retired reminder records. Original booking-request retries after a move may return a conflict because the requested start no longer matches; the session list is the source of truth after edits.

## Reminder delivery and polling

Use PostgreSQL as the durable queue; no Redis or in-memory per-session timers. The worker runs sequential passes every five seconds, bounded to 50 candidate bookings, with retry on the next pass after a failure. Candidates are only hints: reread status and due reminders under locks. The complete order is participant users in UUID order, booking, then reminders. An initial booking-only lock design caused a real PostgreSQL deadlock because inserting notification recipient foreign keys takes user locks; the concurrency test exposed it and the worker now follows the same order as booking changes.

Insert notifications and set delivered_at in one transaction. A unique immutable source_reminder_id is an additional safeguard, deliberately without a reminder foreign key so rescheduling can delete old reminders without deleting notification history. Notification records retain counterpart name, session start, reminder offset, scheduled time, and delivery time. Notifications use factual session timestamps rather than relative claims that could become wrong after a delayed delivery or reschedule.

Exactly once means one persisted in-app notification per reminder, not exactly one worker execution or exactly one browser display. On restart, overdue reminders catch up for confirmed bookings, even if the session has since started or ended. Cancelled bookings are excluded. If delivery commits before a change, its notification remains history; if the change commits first, obsolete reminders cannot be delivered. Graceful shutdown waits for the current pass. Multiple workers are safe, although participant locking intentionally serializes work for the same people; more throughput and backlog fairness can be added if scale requires it.

The frontend polls every 15 seconds while active and refetches on focus/reconnection. Cache keys include user identity and page, and the request consumes React Query's abort signal so logout/unmount can cancel stale reads. Mark-as-read is an owned idempotent update; unread count includes all pages. Offset pagination is adequate for this small app but new deliveries can shift pages, so use cursor pagination at larger scale. No network push, email, SMS, or external delivery is involved.
