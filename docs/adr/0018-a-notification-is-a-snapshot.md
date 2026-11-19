# A Notification is a snapshot

The Notification Catalog is code, not tables: a typed TypeScript registry keyed by event key, each entry carrying its kind (Transactional or Notification Event — looked up through the catalog, never a database column), its recipients, and its per-channel renders. Every in-app delivery writes one immutable row per recipient holding its render at emit — `user_id`, `event_key`, `title`, `body`, `link`, nullable `read_at` — so a Notification never changes once created (ADR-0016): a catalog edit or a renamed course cannot rewrite what someone was told, and the email and push renders run at the same moment from the same in-hand payload, leaving nothing that needs the payload back. Notification Preferences are sparse off-rows — one `notification_preferences` row per turned-off `user_id` × `event_key` × `channel` cell, absence meaning on, so a new catalog event appears in Settings with no backfill — and a Device is one `devices` row per push subscription, keyed by unique `endpoint` for the silent page-load upsert, which refreshes keys, label, and last-seen but never reassigns `user_id` (ADR-0015). Email and push sends write nothing: the snapshot row is the only write per delivery, and a push 404/410 deletes the Device row. The mailer keeps its shape as the pipeline's transport (ADR-0013); routes stop sending email themselves.

## Considered Options

- **A `notification_events` table with a kind column**: rejected — a second source of truth for what is fundamentally code (renders, recipient resolvers); SQLite cannot enforce catalog membership without duplicating it into constraints.
- **A payload column, re-rendered on read**: rejected — the first catalog edit or renamed course would silently rewrite old Notifications, breaking "never changes once it is created"; no settled or fogged feature needs the payload back.
- **A JSON preferences column on `users`**: rejected — the first JSON column in a uniformly scalar schema, with whole-matrix rewrites on each toggle.
- **A materialized full preference matrix**: rejected — every new event needs a backfill; absence-by-default needs none.
- **Routes keeping mailer calls beside the pipeline**: rejected — two delivery paths, and the matrix re-implemented per route.

Per-course Instructor granularity, if that fog ever graduates, extends the off-rows with course scoping — an additive migration, not a rewrite.
