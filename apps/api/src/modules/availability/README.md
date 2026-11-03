# Professional availability

Routes in this plugin inherit authentication and CSRF protection and require the professional role. Identity and timezone come only from the session. GET reads a seven-day week, PUT atomically replaces it, and GET /slots generates four weeks of future slots.

Validation and timezone slot generation are in packages/shared/src/availability.ts; persistence and row locking are in packages/db/src/availability.ts. The second migration creates the recurring working-hours table. Booking conflict subtraction remains part of the future booking feature.
