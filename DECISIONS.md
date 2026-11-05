## Key technical decisions and trade-offs

### PostgreSQL as Database

1. **Prevent double booking at the database level.** PostgreSQL’s exclusion constraints let us reject overlapping time ranges for either a professional or a member—even when requests arrive simultaneously. This is stronger than checking availability only in application code.
2. **Make related changes atomic.** Booking a session and scheduling its reminders commit together. Rescheduling updates the session and reminders in one transaction; if anything fails, the original session remains intact.
3. **Coordinate concurrent operations.** Row locks allow booking, cancellation, rescheduling, and reminder delivery to safely coordinate around the same participants and session.
4. **Store related data consistently.** Users, availability, bookings, reminders, and notifications naturally fit relational tables. Foreign keys prevent records from referencing nonexistent users or bookings.

### Fastify vs Express

I chose Fastify for its built-in schema validation and response serialization, which help keep the API consistent with less setup.
Express offers a broader middleware ecosystem and a familiar programming model, but equivalent validation and serialization usually require additional libraries.

## Assumptions
- Freedom in designing the UI and the UX since there are no requirements.
- Blocking a date does not cancel sessions already scheduled for that day.

## Known limitations
- Reminders are checked every 5 seconds, and the UI polls every 15 seconds, so reminders do not appear instantly.
- No search or filtering in findings professional profiles
- Delivered reminders retain the original session time after rescheduling or cancellation. Users must check My Sessions for the current details.

## What I would do next with more time
- Add password reset, email verification, and profile editing.
- Improve professional discovery with richer profiles, search, and filters.
- Add logging and monitoring.
- Configure automated database backups and test restoration.


## Preventing double-booking
I enforce this in PostgreSQL using exclusion constraints that prevent overlapping confirmed sessions for either the professional or the member. This protects against simultaneous requests, even when both users initially see the slot as available.

Booking operations run inside transactions and lock participant rows in a consistent order before checking availability and saving changes.

## Scheduling and delivering reminders reliably
When a booking is created, reminders for both participants are saved in the same transaction, scheduled for 24 hours and 1 hour before the session. Reminder times that have already passed are skipped. Cancellation removes pending reminders, and rescheduling replaces the schedule transactionally.

A separate worker checks PostgreSQL for due reminders, waiting 5 seconds between passes. Creating the in-app notification and marking its reminder as delivered happen in one transaction. Failed transactions leave reminders pending for retry, while a unique reminder identifier prevents duplicate notifications. Consistent locking coordinates delivery with cancellation and rescheduling.

The UI polls every 15 seconds while the tab is active. This provides durable, duplicate-safe notification creation, but does not guarantee immediate display or that the user has read it. After downtime, the worker processes overdue reminders; a production version would need an explicit policy for reminders that are no longer useful.

## Handling timezones and daylight saving
Users have named IANA timezones, availability is defined in the professional’s local time, while bookings and reminder timestamps are stored as absolute instants using PostgreSQL timestamptz. The UI displays these instants in the viewer’s timezone.

Slot generation uses Temporal to apply the timezone’s offset for each date, keeping weekly local working hours consistent across daylight saving changes.

## What would I consider for production
- Identity and access: Verify professional accounts, add email verification and secure account recovery, introduce MFA, and review permissions using least privilege.
- Data protection: Enforce HTTPS, encrypt databases and backups, manage secrets securely, and prevent sensitive information from appearing in logs.
- Auditability and privacy: Record access and booking changes in protected audit logs, minimize collected data, and define retention and deletion policies.
Operational reliability: Add monitoring for API errors and reminder delays, isolate repeatedly failing jobs, load-test concurrency, and establish incident response procedures.
- Recovery: Configure automated backups and point-in-time recovery, then regularly test restoration against recovery targets. PostgreSQL supports this through base backups and archived transaction logs.
