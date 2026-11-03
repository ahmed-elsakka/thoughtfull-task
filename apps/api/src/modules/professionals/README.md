# Professional directory

GET /api/professionals lists registered professionals in pages of 20. GET /api/professionals/:id returns a public profile. Both require a member session. SQL and response schemas select only id, name, and timezone. Existing users supply profiles, so no migration or seed data is required.
