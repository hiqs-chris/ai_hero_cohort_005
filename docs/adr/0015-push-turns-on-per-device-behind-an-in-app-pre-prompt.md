# Push turns on per device, behind an in-app pre-prompt

The native permission prompt is never called cold: an in-app pre-prompt explains what Cadence will notify the user about, and its button's click is the single user gesture that requests permission, subscribes with the VAPID public key, and stores the row — in one handler, as iOS requires. On uninstalled iPhone Safari the pre-prompt becomes Add-to-Home-Screen guidance rather than a button that would silently do nothing. Devices manage themselves: only the browser that subscribed can turn itself off, a silent page-load upsert self-heals rotated or expired subscriptions, and rows are deleted when a send returns 404/410 — nothing acts on `expirationTime`, and there are no timers or sweeps. The preference matrix's push column is inert until a Device exists: a push send needs the event's cell on and at least one subscription. Push carries notification-class events only — transactional events stay email, so no buyer receives an OS-level interruption the preference matrix cannot switch off.

## Considered Options

- **Calling the native prompt directly, no pre-prompt**: rejected — the native prompt cannot be styled, and once denied it cannot be re-shown by us; asking cold maximizes the chance of landing in the unrecoverable denied state.
- **Cross-device management — removing any Device from any device**: rejected — `unsubscribe()` is a browser API, so a remotely removed Device leaves a row that the page-load upsert would silently re-add on that device's next visit; the Devices list stays informative instead.
- **Push for transactional events**: rejected — transactional events bypass the preference matrix, so a pushed receipt would be an uninterruptible Lock Screen buzz with no kill switch.
