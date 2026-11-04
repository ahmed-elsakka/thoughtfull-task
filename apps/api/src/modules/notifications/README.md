# Notifications

GET /api/notifications returns the authenticated recipient's notifications, total unread count, and next page. PATCH /api/notifications/:id/read accepts an empty JSON body and marks an owned notification read idempotently. Both roles can use these routes; authentication, CSRF, and no-store headers are inherited from auth. Unknown query/body fields are rejected. Response schemas whitelist public notification fields.
