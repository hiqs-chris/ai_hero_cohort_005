# Research: push-to-phone delivery for Cadence

> Wayfinder ticket: [#5 — Research: how does push-to-phone delivery work for a web platform like Cadence?](https://github.com/hiqs-chris/ai_hero_cohort_005/issues/5) · Map: [Wayfinder map: Notifications](https://github.com/hiqs-chris/ai_hero_cohort_005/issues/2) · 2026-11-17

> **Revision (2026-11-17).** The first pass recommended raw Web Push on a no-vendor rationale. The user overrode that premise: **hosted notification services are acceptable, provided a free tier covers small volumes (dev/testing); paid tiers only beyond.** Every option below is re-weighed under that constraint, with free-tier facts checked 2026-11-17.

## Executive summary

**Recommendation: raw Web Push via the [`web-push`](https://github.com/web-push-libs/web-push) npm package — re-affirmed under the free-tier constraint.**

The constraint has real passers: FCM is free at any volume, and OneSignal's free tier covers 10,000 web-push subscribers with unlimited sends. Passing the gate is still not enough to flip the recommendation:

1. **No option removes the local work.** Service worker, web app manifest, iOS Home-Screen install, gesture-gated permission prompt, per-device subscriptions — identical in every option, hosted or not. The effort a hosted service would need to remove is exactly the effort it cannot remove.
2. **What differs is data ownership.** Raw Web Push stores subscriptions (endpoint + keys) in our schema, where the notification data model needs them. Hosted services keep them behind their APIs — OneSignal's free plan purges subscription records dormant for more than 18 months, and FCM registration tokens are bound to the Firebase project.
3. **The hosted extras worth having are paid.** OneSignal gates scheduling, throttling, intelligent delivery, and advanced analytics behind Growth ($19/mo + $0.004/web-push subscriber). Pusher Beams cannot reach iPhone Safari at all — and its desktop Safari path needs a paid Apple certificate, renewed yearly. WonderPush has no free tier.
4. **Migration is asymmetric.** Starting raw keeps the door open: a hosted sender (OneSignal, free ≤10k subscribers) can be added later for campaign-grade sends. Leaving a hosted provider always means re-permissioning every device.

Raw Web Push is free at every volume and mirrors the existing `MailTransport` abstraction in `app/lib/mailer.server.ts` (a `webPushTransport` plus a dev no-op transport, VAPID keys in env).

## How Web Push works

Web push is four standards working together (Apple's framing): the **Push API**, the **Notifications API**, the **Badging API**, and **Service Workers**.

1. **Permission.** From a user gesture, the page calls `Notification.requestPermission()`. On iOS, `PushManager.subscribe()` must then be called immediately from the gesture's event handler.
2. **Subscription.** `PushManager.subscribe()` returns a `PushSubscription`: an `endpoint` (a secret capability URL on the browser vendor's push service), an `expirationTime`, and encryption keys `p256dh` and `auth`. The server stores these with the user's account.
3. **Send.** The server POSTs a Web Push Protocol request to the endpoint. The payload is encrypted with the subscription keys (RFC 8291), the request is signed with a server-held VAPID key pair (RFC 8292), and TTL/urgency/topic options control queueing — the push service holds the message while the device is offline.
4. **Display.** The device wakes the service worker with a `push` event; the handler calls `showNotification()`.
5. **Lifecycle.** `pushsubscriptionchange` fires when a subscription expires or is invalidated; the client resubscribes and the server upserts the stored subscription.

**Safari specifics.** iOS 16.4+ delivers Web Push only to web apps added to the Home Screen from a manifest with `display: standalone` or `fullscreen` (macOS Safari 16+ needs no install). Push rides Apple's Push Notification service (`*.push.apple.com`) over TLS/SNI and needs **no Apple Developer Program membership**. Notifications behave like native ones — Lock Screen, Notification Center, Apple Watch — and the Badging API works too. Safari allows no silent push: it revokes permission if a received notification is not shown immediately.

## Option A — raw Web Push via `web-push`

- The [`web-push`](https://github.com/web-push-libs/web-push) npm package implements the Web Push Protocol and RFC 8291 payload encryption in Node.
- API surface: `generateVAPIDKeys()` (one-time), `setVapidDetails(mailto, publicKey, privateKey)`, `sendNotification(subscription, payload)` with TTL/urgency/topic options. Safari 16+ supported.
- Gotcha: the VAPID subject must not be `localhost` — Apple rejects it with `BadJwtToken`.
- Stack fit: a plain async call in the existing synchronous Node code paths. A `webPushTransport` would mirror `postmarkTransport` / `outboxTransport` in `app/lib/mailer.server.ts` (`Email`, `interface MailTransport`, `sendEmail(...)`), with a dev/test no-op transport and VAPID keys in env next to `POSTMARK_SERVER_TOKEN`.
- Cost: free at every volume — a library, no vendor, no quotas.

## Option B — hosted services

### FCM (Firebase Cloud Messaging, web)

FCM's web API rides the same browser Push API. Requirements: HTTPS, a `firebase-messaging-sw.js` service worker at the domain root, VAPID keys generated or imported in the Firebase console, and Firebase Installation IDs stored on your server; it still reacts to `pushsubscriptionchange`. On the web, FCM is a wrapper around the same W3C Web Push — it adds a Firebase project, an SDK, and a console, and removes none of the local requirements.

Cost: Cloud Messaging is a **no-cost product on both the Spark (no payment method required) and Blaze plans — free at any volume**, so it passes the free-tier gate. What it adds on this stack: a Firebase project, the web SDK, console-managed VAPID keys, and server-side OAuth service-account auth. FCM registration tokens remain per-device state we must store, tied to the Firebase project — migrating away later means re-permissioning every device.

### OneSignal (web push)

Requirements: HTTPS, OneSignal's service worker, a single origin, and user permission. iOS support carries the identical constraint: iOS 16.4+, a `manifest.json`, and the user adding the site to the Home Screen — iOS does not even show the permission prompt until the Home Screen install. OneSignal recommends an in-app pre-prompt before the native dialog. Subscriptions are per browser/device and anonymous until an External ID is assigned.

Cost: the **Free plan ($0/mo) includes web push for up to 10,000 subscribers with unlimited sends** (billed per subscriber, not per send), unlimited API sends, 3 journeys, 6 segments, A/B tests with up to 2 variants, and 30-day reporting history. **Growth (from $19/mo + $0.004 per web-push subscriber)** gates time-delayed/scheduled sends, throttling, intelligent delivery, advanced analytics, CSV exports, and the history API. Caveat: the free plan **purges subscription records dormant for more than 18 months**.

### WonderPush

**No free tier** — a 14-day trial, then from €1/mo + €1 per 1,000 subscribers. Fails the free-tier gate.

### Pusher Beams

Free "Sandbox" covers 1,000 subscribers, then $29/mo per 10,000. The web SDK supports Chrome, Firefox, Edge, and Opera; desktop Safari goes through Apple's legacy Website Push mechanism — a **paid Apple Developer Program membership**, a Website Push ID, a .p12 certificate uploaded to the dashboard, renewed every year — and **iOS/iPadOS Safari is not supported at all**. Fails the push-to-phone requirement regardless of price.

### Others surveyed

SendPulse: free up to 10,000 web-push subscribers (API access and segmentation now paid). Gravitec: free up to 10,000 subscribers. Both wrap the same browser standards. Batch and Airship are enterprise-only with no self-serve free tier. (Secondary sources via web search, 2026-11-17.)

### Expo push

Expo's push service exists to talk to FCM and APNs **for native Android/iOS (Expo/React Native) apps**. It does not apply to a plain web app like Cadence.

## Comparison

|                                   | Raw Web Push (`web-push`)         | FCM (web)                                     | OneSignal (web)                          | Pusher Beams                         | WonderPush                    |
| --------------------------------- | ---------------------------------- | ---------------------------------------------- | ----------------------------------------- | ------------------------------------- | ------------------------------ |
| Service worker required           | Yes (ours)                         | Yes (`firebase-messaging-sw.js` at root)      | Yes (OneSignal's)                         | Yes (Beams SDK)                       | Yes                            |
| iPhone Safari                     | Yes — after Home Screen install    | Yes — after Home Screen install               | Yes — after Home Screen install          | **Not supported**                     | Yes — after Home Screen install |
| Free tier                         | Free at every volume               | Free at any volume (Spark/Blaze)              | 10,000 subscribers, unlimited sends       | 1,000 subscribers                     | None (14-day trial)            |
| Paid beyond                       | —                                  | —                                              | $19/mo + $0.004/subscriber                | $29/mo per 10,000                     | €1/mo + €1 per 1,000 subscribers |
| Vendor account / SDK              | None                               | Firebase project + SDK + console + OAuth      | OneSignal account + SDK                   | Pusher account + SDK                  | WonderPush account + SDK       |
| Subscription data                 | Ours: endpoint + keys              | FCM tokens (project-bound)                    | OneSignal's (purges dormant >18 months)   | Pusher's                              | WonderPush's                   |
| Removes vs. baseline              | —                                  | Nothing local                                  | Nothing local; useful extras paid         | Nothing local                         | Nothing local                  |
| Fit with `MailTransport` pattern  | Direct mirror                      | Indirect                                       | Indirect                                  | Indirect                              | Indirect                       |

_Expo push excluded from the table: native apps only, not applicable to a web platform._

## Recommendation and rationale

Under the user's constraint — hosted services allowed, gated on a free tier that covers small volumes — the comparison lands back on **raw Web Push**, now on pricing and lock-in evidence rather than the withdrawn no-vendor preference:

- The two services that pass the gate (FCM free at any volume; OneSignal free up to 10,000 subscribers) remove none of the local requirements: the service worker, manifest, iOS Home-Screen install, and gesture-gated permission flow are identical to the baseline. Nothing we would otherwise build gets deleted.
- They move subscription data out of our schema. The notification data model needs the subscription records; OneSignal keeps them behind its API (and purges dormant ones on the free plan), and FCM tokens are bound to the Firebase project.
- The extras that would justify a vendor — scheduling, throttling, intelligent delivery, analytics — are exactly what OneSignal puts behind its paid Growth plan. On the free tier we would carry the vendor and still build everything else ourselves.
- Pusher Beams cannot reach iPhone Safari (and its desktop Safari path needs a paid Apple certificate with annual renewal); WonderPush has no free tier. Both fail outright.
- Raw Web Push is free at every volume, and the option stays open in one direction only: a hosted sender (OneSignal, free ≤10k) can be added later for campaign-grade sends; migrating away from a hosted provider always requires re-permissioning every device.

If Cadence later wants marketing-grade campaigns (scheduled sends, journeys, A/B testing), the cheap path is: raw Web Push for transactional/notification sends now, OneSignal added beside it then — not instead of it.

## Implications for downstream tickets

- [Design the notification data model](https://github.com/hiqs-chris/ai_hero_cohort_005/issues/7): store per subscription the `endpoint` (unique), `p256dh`, `auth`, `expirationTime`, and a device label; upsert on `pushsubscriptionchange`; delete rows when sends return 404/410. Keep the model channel-agnostic so a hosted sender's mapping could sit beside raw subscriptions later.
- [Design the push opt-in and subscription flow](https://github.com/hiqs-chris/ai_hero_cohort_005/issues/8): the permission prompt must follow a user gesture with `subscribe()` called in the gesture's handler; on iOS the Home Screen install precedes any prompt (iOS shows nothing until installed); plan an in-app pre-prompt and per-device revocation UI.
- The map's former fog line on iOS PWA installability has its own ticket: [Decide: does Cadence become an installable web app (PWA) so iOS users can get push?](https://github.com/hiqs-chris/ai_hero_cohort_005/issues/11).

## Open questions

- Service worker + manifest registration strategy in React Router 8.3 (framework mode) — a build-time concern for the implementation tickets, not a mechanism decision.
- Whether to also use the Badging API for app-icon badges — small, optional, can ride along later.

## Sources

- MDN — Push API: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- WebKit blog — WebKit Features in Safari 16.4 (Web Push for Home Screen web apps): https://webkit.org/blog/13966/webkit-features-in-safari-16-4/
- Apple — Sending web push notifications in web apps and browsers: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- web.dev — Push notifications overview: https://web.dev/articles/push-notifications-overview
- web-push-libs/web-push: https://github.com/web-push-libs/web-push
- Firebase — FCM web get-started: https://firebase.google.com/docs/cloud-messaging/web/get-started
- Firebase pricing — Cloud Messaging no-cost (checked 2026-11-17): https://firebase.google.com/pricing
- OneSignal — Web Push Setup: https://documentation.onesignal.com/docs/en/web-push-setup
- OneSignal pricing (checked 2026-11-17): https://onesignal.com/pricing
- WonderPush pricing (checked 2026-11-17): https://wonderpush.com/pricing
- Pusher Beams pricing (checked 2026-11-17): https://pusher.com/beams/pricing
- Pusher Beams — Configure Safari (checked 2026-11-17): https://pusher.com/docs/beams/getting-started/web/configure-safari
- Pusher Beams — Web SDK integration, browser support (checked 2026-11-17): https://pusher.com/docs/beams/getting-started/web/sdk-integration
- Expo — Push notifications overview: https://docs.expo.dev/push-notifications/overview/
- SendPulse / Gravitec / Batch / Airship free tiers: web search, secondary sources, 2026-11-17.
