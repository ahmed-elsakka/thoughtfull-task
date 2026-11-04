# Calendar and booking

Member-only calendar, booking, and receipt routes inherit authentication and CSRF handling. The repository revalidates hours under participant locks and commits bookings and reminder records atomically. SQL exclusion constraints protect professional/member overlaps. Request UUIDs provide retry safety, and receipt reads enforce ownership.

GET /api/sessions is registered in a separate authenticated scope so professionals can read their schedule without gaining access to member booking routes. Identity and role come from the session. The response contains the counterpart's name, times, status, and booking ID only. Members may request upcoming or past; professionals may request upcoming.

POST /api/sessions/:id/cancel and /reschedule enforce ownership, CSRF, optimistic expectedStartsAt, and the member's 24-hour deadline. Only members can reschedule; owning professionals can cancel at any time. GET /api/sessions/:id/reschedule-slots exposes only free alternatives to the owning member. Changes lock participants then the booking, updating the booking and reminders in one transaction. Notification delivery remains a separate feature.
