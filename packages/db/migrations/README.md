# Migrations

The initial migration creates users and authentication sessions. The second adds professional weekly working hours with weekday, interval-length, and uniqueness constraints. Run npm run db:migrate from the root; the root .env is loaded automatically. Use npm run db:generate for future schema changes.
