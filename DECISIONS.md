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
I assumed freedom in designing the UI and the UX since there are no requirements

## Known limitations
- Reminders are checked every 5 seconds, and the UI polls every 15 seconds, so reminders do not appear instantly.
- No search or filtering in findings professional profiles
- Delivered reminders retain the original session time after rescheduling or cancellation. Users must check My Sessions for the current details.

## What I would do next with more time
- Add password reset, email verification, and profile editing.
- Improve professional discovery with richer profiles, search, and filters.
- Add logging and monitoring.
- Configure automated database backups and test restoration.
