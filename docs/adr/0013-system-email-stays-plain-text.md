# System email stays plain text, from one sender

Every email Cadence sends is plain text — no HTML body, no template engine. Subjects state the event plainly (`Refund requested — <course title>`), no prefix. Each event in the notification catalog owns its copy as a pure function from the event and its recipient to `{subject, body}` — the greeting varies by recipient, the one deviation from the spec's sketch — so an event's copy is authored in exactly one place, versioned with the code, and previewable through the outbox. All system mail sends as `Cadence <hello@cadence.dev>` with no Reply-To header; replies land at hello@, a monitored inbox Platform Admins watch. Preferenced (notification-class) emails end with a "Manage your notification settings" line linking to Settings; transactional emails carry no such footer.

## Considered Options

- **In-repo HTML templates (e.g. React Email)**: rejected — an email design system and a cross-client testing matrix to maintain, for mail whose job is "this happened, come look at Cadence"; plain text also delivers best from a small sender domain.
- **Postmark templates**: rejected — copy would leave the repo: no version control, no preview through the outbox in tests.
- **Per-class sender addresses (`noreply@`, `notifications@`)**: rejected — splits one sender reputation across mailboxes and adds sender-signature setup, for no benefit at this volume.
