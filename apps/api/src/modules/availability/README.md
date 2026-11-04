# Professional availability

Routes in this plugin inherit authentication and CSRF protection and require the professional role. Identity and timezone come only from the session. GET reads a seven-day week, PUT atomically replaces it, and GET /slots generates four weeks of future slots.

Validation and timezone slot generation are in packages/shared/src/availability.ts; persistence and row locking are in packages/db/src/availability.ts. The second migration creates the recurring working-hours table. Booking conflict subtraction remains part of the future booking feature.

## Blocked dates

GET, POST and DELETE /api/professional/blocked-dates let a professional block calendar dates, for example holidays. Dates are YYYY-MM-DD values in the professional's own timezone and must be between today and 365 days ahead. POST is idempotent (201 when added, 200 when already blocked) and DELETE is idempotent. Responses list upcoming blocked dates with the number of confirmed sessions still booked on each. Blocking never cancels existing sessions. Slot generation in packages/shared removes every slot that starts on a blocked date, and the calendar, booking, reschedule and preview paths all read the blocked dates under the same professional lock used for working-hours changes, so a booking cannot slip in after a block commits.
