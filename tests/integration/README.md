# PostgreSQL concurrency verification

Run npm run test:postgres with a local DATABASE_URL and CREATE DATABASE permission. The script creates a uniquely named test database, applies migrations, tests independent concurrent connections, and cleans up its own database afterwards. It refuses nonlocal servers and never clears application tables.
