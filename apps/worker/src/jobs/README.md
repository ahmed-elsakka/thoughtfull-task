# Reminder jobs

Implement polling of durable reminder rows here. Notification insertion and marking a reminder delivered must share a transaction, with a unique reminder ID on notifications. Coordinate cancellation and rescheduling through consistent row locking.
