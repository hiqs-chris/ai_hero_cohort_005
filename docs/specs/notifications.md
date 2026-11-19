# Notifications

Status: locked. The six open points are resolved inline (2026-11-19, confirmed with the user); this document is the implementation-ready spec for notifications on Cadence, published as [spec issue #12](https://github.com/hiqs-chris/ai_hero_cohort_005/issues/12), and build tickets are cut from it.

Decision records: [ADR-0013](../adr/0013-system-email-stays-plain-text.md) email, [ADR-0014](../adr/0014-cadence-becomes-an-installable-web-app-for-iphone-push.md) installable web app, [ADR-0015](../adr/0015-push-turns-on-per-device-behind-an-in-app-pre-prompt.md) push opt-in, [ADR-0016](../adr/0016-unread-means-unseen.md) unread semantics, [ADR-0017](../adr/0017-one-happening-many-events.md) event kinds, [ADR-0018](../adr/0018-a-notification-is-a-snapshot.md) the data model. Two records are required by the spec and land with the build: one for the single pipeline, one for synchronous best-effort delivery.

Visual reference: the [prototype branch](https://github.com/hiqs-chris/ai_hero_cohort_005/tree/prototype/notification-surfaces) (never merged). `PrototypeBellB` and `SettingsB` in `app/components/prototype-notifications.tsx` are the reference for the chosen structure; the prototype's own popover, toggle, and badge are throwaway chrome, and the build picks its own primitives.

## The model

One pipeline, two classes, three channels. A happening on Cadence emits events from a catalog that is code. Each event has exactly one kind. A Transactional Event always reaches the recipient's email and the in-app list, never push, and no preference can switch it off. A Notification Event reaches the in-app list, email, and push as the recipient's preferences say. Every in-app delivery writes one immutable row holding the rendered words at emit time, so a Notification never changes after it is created.

## The catalog

The catalog is a typed TypeScript registry in one file, keyed by event key. An entry names its kind, who the event is addressed to, and what it says on each channel. Adding a happening Cadence tells people about is adding an entry; no migration follows, and the new event appears in Settings with no backfill.

```ts
type EventKind = "transactional" | "notification";

type CatalogEntry<P> = {
  key: string; // <subject>.<past-tense-verb>
  kind: EventKind;
  icon: IconName; // the row icon in the in-app list
  audience: string; // Settings card line, e.g. "Platform Admins"
  blurb: string; // Settings card line, what the event reports
  recipients(tx: Queryable, payload: P): User[];
  renderInApp(payload: P): { title: string; body: string; link: string };
  renderEmail(payload: P): { subject: string; body: string };
  renderPush?(payload: P): { title: string; body: string }; // notification events only
};
```

A happening may emit several events ([ADR-0017](../adr/0017-one-happening-many-events.md)): raising a Refund Request emits one event telling every Platform Admin and another telling the buyer. Keys follow `<subject>.<past-tense-verb>`; the subject is a glossary noun, the verb is what the recipient learns happened.

## The first four events

### refund_request.raised

- Kind: Notification Event.
- Addressed to: every Platform Admin at the moment the request is raised. The review page is a shared queue where the first decision wins and nothing assigns requests, so every admin is told. The render names the purchase kind, Individual Purchase or Team Licence.
- Channels: in-app, email, and push, each per the admin's preferences.
- Link: `/admin/refunds`, which opens on the Open filter where the new request sits.
- In-app: title `Refund request raised`, body `{course title} · {purchase kind} · {price} · {buyer name}`.
- Email: subject `New refund request — {course title}`, body:

```
Hi {admin name},

{buyer name} asked for a refund on "{course title}".

Purchase: {Individual Purchase | Team Licence}
Amount: {price}

Their reason:

"{reason}"

Review it on the refunds page, under Open:
{APP_URL}/admin/refunds

Manage your notification settings: {APP_URL}/settings
```

### refund_request.received

- Kind: Transactional Event.
- Addressed to: the buyer.
- Channels: email and the in-app list, always. Never push. Exempt from preferences, so no manage-settings footer.
- Link: `/settings`, where the buyer already sees their Refund Requests.
- In-app: title `Refund request received`, body `"{course title}" · {price}`.
- Email: today's confirmation from `raiseRefundRequest`, moved verbatim into the catalog entry. Subject `Refund requested — {course title}`, body:

```
Hi {buyer name},

We have your refund request for "{course title}".
The refund is for {price}, the amount you paid.

Our team reviews every refund request by hand. You do not need to do anything else — we will email you again when it is done.

— The Cadence team
```

### refund_request.decided

- Kind: Transactional Event.
- Addressed to: the buyer. One event whose render branches on the outcome, because the buyer experiences "my request was decided" and, being exempt from preferences, there is no benefit to splitting it.
- Channels and link: as `refund_request.received`.
- In-app: title `Refund approved` or `Refund declined`, body `"{course title}" · {price}`.
- Email: today's `buildDecisionEmail` moved verbatim. Subject `Refund {approved|declined} — {course title}`, body:

```
Hi {buyer name},

We have approved your refund request for "{course title}".
{price}, the full amount you paid, is on its way back to you.
{the Platform Admin's note, if one was written}

— The Cadence team
```

```
Hi {buyer name},

We have looked at your refund request for "{course title}" and decided not to refund it.
{the Platform Admin's note, required on a decline}

You still have everything you bought. If something changes, you can raise a new refund request.

— The Cadence team
```

### question.asked

- Kind: Notification Event.
- Addressed to: the course's Instructor. Fires once, at comment creation, when the new comment is a Question at that moment: top-level, author neither an Admin nor that course's Instructor. That is the instructor queue's own birth rule, applied at birth. Replies never fire it, edits cannot change Question-ness, and a later delete or staff answer leaves the Notification in place, because Notifications are immutable.
- Channels: in-app, email, and push, each per the instructor's preferences.
- Link: `/instructor/questions`, the reply surface, where the queue lists newest first.
- In-app: title `New question`, body `{course title} · {lesson title} · {asker name}`.
- Email: subject `New question on {course title}`, body:

```
Hi {instructor name},

{asker name} asked a question on "{course title}".

Lesson: {lesson title}

"{question}"

Reply from your question queue, newest first:
{APP_URL}/instructor/questions

Manage your notification settings: {APP_URL}/settings
```

### Edge cases

- An Instructor asking on another instructor's course is a Question, so the event fires and that course's Instructor is told.
- No dedupe rule is needed: `UserRole` holds exactly one role, so a recipient set never contains a user twice.
- No actor exclusion anywhere. The one overlap, a Platform Admin who bought a course and raised a refund request on it, receives `refund_request.raised` like every other admin, which is correct: the request is theirs to decide or hand off.

## Data model

Three tables and one enum, in `app/db/schema.ts` ([ADR-0018](../adr/0018-a-notification-is-a-snapshot.md)). Kind lives in the catalog, never in a database column; rows reference events by `event_key` text.

A Notification row is a rendered snapshot, written at emit. There is no payload column: the email and push renders run at the same moment from the same in-hand payload, so nothing needs the payload back, and a catalog edit or a renamed course can never rewrite what someone was told.

```ts
export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id),
    eventKey: text("event_key").notNull(), // a Notification Catalog key
    title: text("title").notNull(), // in-app render, snapshotted at emit
    body: text("body").notNull(),
    link: text("link").notNull(), // click-through target
    readAt: text("read_at"), // null = Unread Notification (ADR-0016)
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index("notifications_user_created_idx").on(t.userId, t.createdAt)],
);
```

Preferences are sparse off-rows. One row per turned-off cell; absence means on, which is why a new catalog event needs no backfill. Rows only ever hold Notification Event keys, because Transactional Events are exempt.

```ts
export enum NotificationChannel {
  Email = "email",
  InApp = "in_app",
  Push = "push",
}

export const notificationPreferences = sqliteTable(
  "notification_preferences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id),
    eventKey: text("event_key").notNull(), // a Notification Event's key, never transactional
    channel: text("channel").notNull().$type<NotificationChannel>(),
  },
  (t) => [
    uniqueIndex("notification_preferences_user_event_channel_unique").on(
      t.userId,
      t.eventKey,
      t.channel,
    ),
  ],
);
```

A Device is one row per push subscription, keyed on unique `endpoint` for the silent page-load upsert ([ADR-0015](../adr/0015-push-turns-on-per-device-behind-an-in-app-pre-prompt.md)).

```ts
export const devices = sqliteTable("devices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  expirationTime: text("expiration_time"), // stored as data; nothing acts on it
  label: text("label").notNull(), // auto-derived, e.g. "Safari · iPhone"
  lastSeenAt: text("last_seen_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
```

Timestamps are ISO text per schema convention; `expirationTime`, which the browser reports as epoch milliseconds, converts at the edge. On an endpoint conflict the upsert refreshes keys, label, and `last_seenAt` but never reassigns `user_id`: a subscription never moves to a different user on the same browser.

## Preferences

All cells are on by default. A turned-off cell is one off-row; turning a cell back on deletes the row. Writes reject Transactional Event keys, and the Settings UI never offers them, so no off-row can exist for one.

The in-app cell of a Notification Event gates that event's in-app delivery for that user. When it is off, the pipeline writes no snapshot row for that user and event, and email and push still run per their own cells. A push to a user with no row carries no notification id, so its click-through marks nothing read. A user can mute an event on every channel; the Questions queue and the refunds review page still exist, so nothing is hidden from them that they cannot see on demand.

> **Resolved (spec #12).** Three-column reading: the in-app cell is a real toggle for Notification Events, exactly as this section describes. The glossary's Notification Event entry gets its one-line fix in the build; ADR-0016's "every event lands in the center" holds for Transactional Events (always-on) and as the default (all cells on).

Transactional Events never appear as preference cards. They sit in the boxed always-sent group underneath.

Editing preferences never touches Devices, and subscribing never touches the matrix. The push cell is silently inert until the user has a Device; the card hints this when none exists.

## The emit pipeline

The pipeline is the only code that sends anything. It has two phases.

**Plan, inside the domain transaction.** `emit(tx, eventKey, payload)` resolves recipients through the catalog, checks the preference matrix for each Notification Event recipient and channel, renders every channel from the in-hand payload, and writes the snapshot rows. It returns the send plan: the emails to send and, per Device, the pushes to send, each push carrying its notification id where a row was written.

**Deliver, after the transaction commits.** The route action that ran the transaction calls `deliver(plan)`, which sends each email through the mailer and each push through the push transport. Sends write nothing except one case: a push returning 404 or 410 deletes that Device row. A send failure is logged with the event key and recipient and otherwise swallowed. `deliver` never throws at its caller, so a Postmark outage cannot turn a committed refund decision into a 500. There are no retries and no resend mechanism; a lost send is lost, and the in-app row is the durable record.

> **Resolved (spec #12).** The snapshot rows commit inside the domain transaction — a happening and its in-app notifications commit together or not at all.
>
> **Resolved (spec #12).** Sends run best-effort after commit — a send failure is logged with the event key and recipient and otherwise swallowed. Today's behavior, where a Postmark failure breaks the response after the write already committed, is replaced.

The call sites, one per happening:

- `raiseRefundRequest` in `app/lib/refunds.server.ts` emits `refund_request.raised` and `refund_request.received`. The transaction already exists; the emit joins it.
- `approveRefundRequest` and `declineRefundRequest` in the same file emit `refund_request.decided`.
- Comment creation emits `question.asked`. There are two creation sites, `createComment` in `app/routes/instructor.questions.tsx` and `createComment` in `app/routes/courses.$slug.lessons.$lessonId.tsx`; the birth rule runs at both, and each insert plus its snapshot rows becomes one transaction.

`raiseRefundRequest`, `approveRefundRequest`, and `declineRefundRequest` lose their `email` return field. `buildDecisionEmail` and the confirmation render move verbatim into the catalog entries. `app/routes/courses.$slug.refund.ts` and `app/routes/admin.refunds.tsx` stop importing `sendEmail`. The mailer in `app/lib/mailer.server.ts` keeps its shape untouched and gains exactly one caller, the pipeline ([ADR-0018](../adr/0018-a-notification-is-a-snapshot.md)).

## Email

[ADR-0013](../adr/0013-system-email-stays-plain-text.md), restated as rules for the build:

- Plain text. No HTML body, no template engine.
- One sender for all system mail: `Cadence <hello@cadence.dev>`, no Reply-To. Replies land at hello@, a monitored inbox Platform Admins watch.
- Subjects state the event plainly, no prefix.
- Each event's catalog entry owns its render as a pure function from payload to subject and body, versioned in the repo and previewable through the outbox.
- Preferenced emails end with a `Manage your notification settings: {APP_URL}/settings` line. Transactional emails never do.

Today's emails contain no links, so no base URL exists anywhere. Email links and push payload URLs need one: a new `APP_URL` env holding the deployment origin, defaulting to localhost in dev.

In dev and tests, `POSTMARK_SERVER_TOKEN` unset, the outbox transport writes each message to `.outbox/` as JSON, exactly as today.

## Push

Raw Web Push through the `web-push` npm package. `sendNotification` is a plain async call that fits the synchronous Node stack. FCM and OneSignal were considered and rejected under the free-tier constraint; the comparison and sources are on the research branch, `research/push-to-phone-delivery`, `docs/research/push-to-phone-delivery.md`.

Transports mirror the mailer. `webPushTransport` sends when the VAPID keys are set; a no-op transport logs in dev and tests. Env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. The public key reaches the browser through the root loader.

`public/manifest.webmanifest` declares `display: "standalone"` beside the service worker, which push needs on every platform anyway ([ADR-0014](../adr/0014-cadence-becomes-an-installable-web-app-for-iphone-push.md)). The manifest changes nothing until someone installs. `public/sw.js` handles `push`, `notificationclick`, and `pushsubscriptionchange`, and registers on authenticated pages, scope `/`. Logged-out pages never register it, because a subscription needs an owner.

Push carries Notification Events only; Transactional Events stay email, so no buyer gets an OS-level interruption the preference matrix cannot switch off ([ADR-0015](../adr/0015-push-turns-on-per-device-behind-an-in-app-pre-prompt.md)).

The payload is `{title, body, url, notificationId}`. The `push` handler shows the notification; `notificationclick` focuses an open window on the URL or opens one, and the app marks the row read on arrival.

> **Resolved (spec #12).** The push payload carries the notification id; the service worker opens `{url}?notification={id}`, the app marks that row read, and strips the parameter.
>
> **Resolved (spec #12).** The catalog keeps a separate `renderPush` slot, so a future event can push different words without touching the mechanism; the two Notification Events default it to the in-app render's title and body.

### Opt-in

Two entry points, one flow: the Turn on push on this device button in Settings under Your devices, and the Turn on push notifications button in the bell list's empty state. No contextual nudges anywhere else.

The native permission prompt is never called cold. The in-app pre-prompt explains what the role can receive, and its button's click is the single user gesture that requests permission, subscribes with the VAPID public key, and posts the row, all in the one handler, as iOS requires.

Pre-prompt copy, role-honest:

- Platform Admin: title `Turn on push notifications`, body `When a buyer raises a Refund Request, it reaches your phone. Receipts and decisions stay in your inbox.`
- Instructor: title `Turn on push notifications`, body `When someone asks a Question on your courses, it reaches your phone. Receipts and decisions stay in your inbox.`
- Student and Team Admin, who receive nothing that can push today: title `Turn on push notifications`, body `Nothing you receive today can push. When there's activity on your courses, it will reach your phone.`

Uninstalled iPhone Safari, detected by `navigator.standalone === false` or `display-mode`, shows Add-to-Home-Screen steps in place of a button that would silently do nothing: add Cadence to the Home Screen from the share sheet, open it from there, then turn on push. Android and desktop subscribe directly.

Permission denied: no button, just per-browser unblock instructions. Chrome points at the site settings for cadence.dev; iPhone points at Settings, then Cadence, then Notifications. Permission dismissed: the button stays available, and we may ask again.

### Device lifecycle

- **Subscribe**: the pre-prompt gesture, as above. The row's label is auto-derived from the subscription and user agent, e.g. `Safari · iPhone`, and is not user-editable.
- **Refresh**: on every authenticated page load, a held subscription with permission granted is silently posted and the server upserts by endpoint. `pushsubscriptionchange` is handled in the worker where it fires, but the page-load upsert is the reliable self-healing path. An expired or rotated subscription is resubscribed in place; permission is already granted, so no gesture is needed. Nothing acts on `expirationTime`; the server stores it as data. No timers, no sweeps.
- **Turn off**: the Turn off control on the owning device's row calls `unsubscribe()` and deletes the row. Only the owning browser can turn a Device off, because a remotely deleted row would be silently re-added by that device's next page-load upsert. The Devices list is informative: label and last seen.
- **Invalidation**: a send returning 404 or 410 deletes the row. No speculative deletion.
- **Logout** leaves subscriptions alone, and a subscription never reassigns to a different user on the same browser. Shared-computer confusion is an accepted edge, not a solved one.

## The in-app list

The bell is icon-only, in the sidebar's user row beside the settings gear, with a floating badge counting the user's unread notifications, capped at `9+`. Every signed-in user has it, Students included. Clicking it opens a wide popover anchored to the bell:

- Header: `Notifications`, the unread count, and a `Mark all read` control.
- Rows, newest first: an icon, the title, one detail line, a trailing relative time, and an unread dot. Unread rows tint; read rows dim and stay. One row per event, no day grouping, no roll-up counters.
- Click navigates to the event's link and marks the row read, one action.
- Footer: `Manage preferences`, linking to Settings.
- Empty state: `You're all caught up`, with the push pitch and the Turn on push notifications button, the second opt-in entry point. Pitch copy as prototyped: `Refund Requests and Questions can reach your phone. Push carries notification events only — receipts and decisions stay in your inbox.`

The list shows all of the user's notifications with no pagination; the 30-day retention bounds it.

> **Resolved (spec #12).** No pagination and no cap — retention already bounds the list and the popover scrolls.

Read semantics ([ADR-0016](../adr/0016-unread-means-unseen.md)): read happens only by the recipient's own act, click-through or Mark all read. Opening the list marks nothing. Resolving the subject, answering the Question or deciding the Refund Request, never touches read state. One read state per row, shared across channels: a push click-through reads the row, and plain-text email never can.

Retention, with no background jobs: on authenticated page load, delete the signed-in user's read notifications older than 30 days. Unread notifications are never auto-deleted, because deleting one would drop a fact its recipient has not seen. The badge, the list, and marks are computed on load and navigation; there is no realtime.

## Settings

The Notifications section on `app/routes/settings.tsx`, variant B from the prototype:

- Intro line: `Each notification event, and where you want it. The always-sent events sit underneath, out of your way.`
- One card per Notification Event the user can receive: title, `Addressed to {audience} · {blurb}`, and three labeled toggles to the right, In-app, Email, Push. The push toggle is disabled with a hint until a Device exists: `Push needs a Device: turn notifications on from your phone or browser first. Until then the Push toggles do nothing.` With a Device: `Push is live for your Device — turning an event's push off stops it on every Device.`
- The boxed group underneath, dashed border, lock icon, heading `Always sent — no preferences`, explainer `Transactional events land in your notification list and your inbox whatever you choose here. They never push.`, listing the transactional events with `Email + in-app, always`.

Cards per role: Platform Admins get `refund_request.raised`; Instructors get `question.asked`; everyone gets the boxed `refund_request.received` and `refund_request.decided`.

The Your devices block: the list, label and last seen per row with a Turn off control on the owning row, and the Turn on push on this device button that opens the pre-prompt.

Actions: a toggle off inserts the off-row; a toggle on deletes it. Turn on push runs the opt-in flow; Turn off unsubscribes and deletes the row.

## Suggested files and routes

Suggested shape, to keep build tickets from re-deciding placement. The build may reshape any of it.

| Path | Purpose |
| --- | --- |
| `app/lib/notifications/catalog.ts` | the catalog, one entry per event |
| `app/lib/notifications/emit.server.ts` | plan inside the transaction, deliver after commit |
| `app/lib/notifications/push.server.ts` | `webPushTransport` and the dev no-op transport |
| `app/db/schema.ts` | the three tables and `NotificationChannel` |
| `public/manifest.webmanifest` | `display: standalone`, name, icons |
| `public/sw.js` | push, notificationclick, pushsubscriptionchange |
| `app/routes/notifications.ts` | resource route: GET the list, POST mark one or all read |
| `app/routes/devices.ts` | resource route: POST subscribe or silent upsert, DELETE turn off |
| `app/routes/settings.tsx` | preference toggles, Your devices, the pre-prompt entry |
| root loader | unread count, VAPID public key, the 30-day prune |

## Invariants

The locked checklist. A build ticket that breaks one of these is wrong.

1. Routes never import `sendEmail`. The pipeline is the mailer's only caller.
2. Kind lives in the catalog, never in a database column.
3. A Notification row is immutable. Renders run at emit from the in-hand payload. There is no payload column.
4. Transactional Events: email and in-app always, never push, exempt from preferences, no manage-settings footer.
5. Notification Events: each channel per the recipient's preferences; a push send also needs a Device; preferenced emails carry the footer.
6. Preferences are sparse off-rows over Notification Event keys only; absence means on.
7. Read happens only by click-through or Mark all read, never by resolving the subject; one read state per row, shared across channels.
8. Read rows older than 30 days are pruned on authenticated page load; unread rows never are.
9. Snapshot rows commit with the happening; sends run after commit, best-effort; a push 404 or 410 deletes the Device row.
10. Devices key on endpoint; the upsert never reassigns the user; only the owning browser turns a Device off.
11. The badge counts unread notifications. Counts, the list, and marks are computed on load; there is no realtime.

## Not in v1

The catalog is open by design. These wait on the pipeline landing: a Question answered telling the asker, a welcome email on purchase, the existing TODO in `app/routes/courses.$slug.purchase.tsx`; per-course granularity for Instructors, which extends the off-rows with course scoping, an additive migration ([ADR-0018](../adr/0018-a-notification-is-a-snapshot.md)); digests; Team-Admin events.

Ruled out of this effort entirely: realtime updates, queues or outbox or workers, a native mobile app, any install campaign beyond the opt-in flow, Slack, Discord, webhooks.
