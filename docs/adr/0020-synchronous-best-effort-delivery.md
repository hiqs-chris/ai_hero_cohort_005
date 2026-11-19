# Synchronous best-effort delivery

The plan is computed and the snapshot rows written inside the domain transaction — a happening and its in-app notifications commit together or not at all. The route action that ran the transaction calls `deliver(plan)` after commit, best-effort: a failure is logged with the event key and recipient and otherwise swallowed, `deliver` never throws at its caller — a Postmark outage cannot turn a committed refund decision into a 500 — and there are no retries. A lost send is lost; the in-app row is the durable record. Sends write nothing except one case: a push returning 404/410 deletes that Device row (ADR-0015).

## Considered Options

- **Sends inside the transaction** — an external call holding the write lock; a failure would roll back the committed decision.
- **A queue with retries** — no background jobs exist on Cadence; the same reason retention is a page-load sweep (ADR-0016).
- **Propagating failures to the caller** — a 500 after commit would tell the user their refund failed when it succeeded.
