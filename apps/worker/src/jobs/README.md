# Reminder jobs

The worker in ../reminders.ts polls the database notification store every five seconds. Delivery lives in packages/db/src/notifications.ts so real SQL tests and multiple worker processes use the same transaction logic. Acquire participant users in UUID order, then the booking, then due reminders. Notification insertion and delivered_at updates share a transaction, with a unique source reminder ID. Catch-up runs immediately on startup. Failed passes retry; shutdown waits for the active pass and closes the pool.
