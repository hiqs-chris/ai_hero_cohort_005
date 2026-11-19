# One pipeline, two classes

All delivery flows through one notification pipeline (`emit` and `deliver` in `app/lib/notifications/emit.server.ts`); it is the mailer's one and only caller, and no route sends anything itself. Every event has exactly one kind, and kind lives in the catalog entry, never in a database column — rows reference events by `event_key` text only (ADR-0018). A Transactional Event always reaches email and the in-app list, never push, exempt from the preference matrix (ADR-0015); a Notification Event reaches in-app, email, and push as the recipient's preferences say. A happening may emit several events, each with its own kind and audience (ADR-0017).

## Considered Options

- **Routes keep their own mailer calls** — two delivery paths; the matrix would be re-implemented per route.
- **Kind as a database column** — a second source of truth for what is code.
- **Kind per audience** — rejected in ADR-0017.
