# Unread means unseen

Every event the pipeline delivers in-app leaves one Notification record per recipient — one per event, never rolled up into a per-subject counter, never re-unread by later activity — and every event lands in the center: transactional events arrive always-on, exempt from the preference matrix exactly as they are on email, while push alone stays notification-class (ADR-0015). A record carries a single read state shared across channels — a push click-through reads it, plain-text email (ADR-0013) never can — and read means the recipient has seen it, by opening it or marking it read, and nothing else: answering the Question or deciding the Refund Request it reports leaves it unread until then. Read notifications stay in the one list, dimmed, with no archive and no delete; on authenticated page load each user's read notifications older than 30 days are deleted — the same silent self-heal the Device upsert uses, since there are no background jobs — and unread notifications are never deleted, because deleting one would drop a fact its recipient has not seen.

## Considered Options

- **Badge derived from domain state (unanswered Questions, Open Refund Requests)**: rejected — the center becomes a second Questions page, there is no history of what happened, and mark-as-read has nothing to act on.
- **Transactional events kept out of the center**: rejected — the center would be a preferenced Instructor/Admin feed, and a Student's refund decision would leave no in-app trace.
- **Mark-on-open (opening the center reads everything)**: rejected — a glance would clear the badge before anything was engaged with; only click-through or an explicit mark-all-read reads.
- **Resolving the subject marks its notifications read**: rejected — a hidden write in every future action route, and unread would stop meaning "you haven't seen this" and start meaning "you might not know about this", which the system cannot know.
- **Roll-up per subject ("2 new Questions"), re-unreading on new activity**: rejected — that unread would mean "new activity since you looked", a different concept, and it needs update-in-place writes inside delivery.
- **Per-item delete or an archive section**: rejected — no driver like the comments' keep-replies-readable rule; retention, not the user, is the cleanup mechanism.
- **Keep-forever retention**: rejected — the table would grow without bound with no background job to sweep it.
