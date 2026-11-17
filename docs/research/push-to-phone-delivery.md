# Research: push-to-phone delivery for Cadence

> Wayfinder ticket: [#5 — Research: how does push-to-phone delivery work for a web platform like Cadence?](https://github.com/hiqs-chris/ai_hero_cohort_005/issues/5) · Map: [Wayfinder map: Notifications](https://github.com/hiqs-chris/ai_hero_cohort_005/issues/2) · 2026-11-17

## Executive summary

**Recommendation: raw Web Push via the [`web-push`](https://github.com/web-push-libs/web-push) npm package.**

Cadence should implement the W3C Web Push standards directly. Every browser-side requirement — a service worker, a web app manifest, a user-gesture permission prompt, per-device subscriptions — applies equally to the third-party services: FCM and OneSignal wrap the same standards without removing any local requirement, and iOS requires a Home-Screen-installed web app regardless of mechanism. A vendor therefore adds an account, an SDK, and a console while removing nothing. `web-push`'s `sendNotification(subscription, payload)` is a plain asynchronous call that fits Cadence's synchronous Node stack and mirrors the existing `MailTransport` abstraction in `app/lib/mailer.server.ts` (a `webPushTransport` plus a dev no-op transport, VAPID keys in env).

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

## Option B — third-party services

### FCM (Firebase Cloud Messaging, web)

FCM's web API rides the same browser Push API. Requirements: HTTPS, a `firebase-messaging-sw.js` service worker at the domain root, VAPID keys generated or imported in the Firebase console, and Firebase Installation IDs stored on your server; it still reacts to `pushsubscriptionchange`. On the web, FCM is a wrapper around the same W3C Web Push — it adds a Firebase project, an SDK, and a console, and removes none of the local requirements.

### OneSignal (web push)

Requirements: HTTPS, OneSignal's service worker, a single origin, and user permission. iOS support carries the identical constraint: iOS 16.4+, a `manifest.json`, and the user adding the site to the Home Screen — iOS does not even show the permission prompt until the Home Screen install. OneSignal recommends an in-app pre-prompt before the native dialog. Subscriptions are per browser/device and anonymous until an External ID is assigned.

### Expo push

Expo's push service exists to talk to FCM and APNs **for native Android/iOS (Expo/React Native) apps**. It does not apply to a plain web app like Cadence.

## Comparison

|                                   | Raw Web Push (`web-push`)        | FCM (web)                                    | OneSignal (web)                       | Expo push                     |
| --------------------------------- | --------------------------------- | --------------------------------------------- | -------------------------------------- | ------------------------------ |
| Service worker required           | Yes (ours)                        | Yes (`firebase-messaging-sw.js` at root)     | Yes (OneSignal's)                     | N/A                            |
| Manifest / iOS Home Screen install | Required for iOS                 | Required for iOS                              | Required for iOS                       | N/A                            |
| VAPID keys                        | Ours, in env                      | Firebase console                              | Managed by OneSignal                   | N/A                            |
| Vendor account / SDK              | None                              | Firebase project + SDK + console              | OneSignal account + SDK                | Expo account (native only)     |
| Subscription storage              | Ours: endpoint + keys             | Firebase Installation IDs + ours              | OneSignal's (External ID mapping)     | N/A                            |
| Cost                              | Free (library)                    | Free tier                                     | Free tier, paid tiers above            | N/A                            |
| Fit with `MailTransport` pattern  | Direct mirror                     | Indirect                                      | Indirect                               | N/A                            |

## Recommendation and rationale

**Raw Web Push via `web-push`.** The browser requirements are identical across options, so a third-party service adds dependency and lock-in without removing any constraint — most notably the iOS Home Screen install, which every option inherits. Raw Web Push keeps subscription data in our own schema (it becomes part of the notification data model), keeps the sending code shaped like the mailer we already have, and costs nothing but a VAPID key pair.

## Implications for downstream tickets

- [Design the notification data model](https://github.com/hiqs-chris/ai_hero_cohort_005/issues/7): store per subscription the `endpoint` (unique), `p256dh`, `auth`, `expirationTime`, and a device label; upsert on `pushsubscriptionchange`; delete rows when sends return 404/410.
- [Design the push opt-in and subscription flow](https://github.com/hiqs-chris/ai_hero_cohort_005/issues/8): the permission prompt must follow a user gesture with `subscribe()` called in the gesture's handler; on iOS the Home Screen install precedes any prompt (iOS shows nothing until installed); plan an in-app pre-prompt and per-device revocation UI.
- The map's fog line on iOS PWA installability has graduated into its own ticket: [Decide: does Cadence become an installable web app (PWA) so iOS users can get push?](https://github.com/hiqs-chris/ai_hero_cohort_005/issues/11).

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
- OneSignal — Web Push Setup: https://documentation.onesignal.com/docs/en/web-push-setup
- Expo — Push notifications overview: https://docs.expo.dev/push-notifications/overview/
