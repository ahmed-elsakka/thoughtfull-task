# Calendar and booking

Member-only calendar, booking, and receipt routes inherit authentication and CSRF handling. The repository revalidates hours under participant locks and commits bookings and reminder records atomically. SQL exclusion constraints protect professional/member overlaps. Request UUIDs provide retry safety, and receipt reads enforce ownership.

My sessions, cancellation/rescheduling, and notification delivery are separate features.
