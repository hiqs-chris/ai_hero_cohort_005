# One happening, many events: kind belongs to the event

Raising a Refund Request tells two audiences different things: every Platform Admin learns a request was raised (delivered as each admin prefers), and the buyer learns their request was received (always delivered). Rather than one event carrying a delivery kind per audience, the notification catalog is a list of events, each with exactly one kind — Transactional Event or Notification Event — and a single happening may emit several events (`refund_request.raised` and `refund_request.received` from one raise). Event keys follow `<subject>.<past-tense-verb>` (`refund_request.raised`, `question.asked`): the subject is a glossary noun, the verb is what the recipient learns happened.

## Considered Options

- **One event per happening, kind per audience**: rejected — the event×channel preference matrix keys on the event, so an event that is preferenced for one audience and exempt for another has no single behaviour in the matrix. A kind as a per-audience property would also blur the guarantee a kind gives: a Transactional Event is always delivered, full stop.
