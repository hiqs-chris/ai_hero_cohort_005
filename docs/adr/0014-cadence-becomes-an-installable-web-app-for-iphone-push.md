# Cadence becomes an installable web app for iPhone push

iPhone Safari delivers Web Push only to web apps installed from the Home Screen, which takes a web app manifest with `display: standalone` plus a service worker — and the service worker is required for push on every platform anyway, so the manifest is the only iOS-specific addition. Cadence adopts both: the manifest exists to unlock iPhone push, `display: standalone` changes nothing until someone chooses to install, and Add-to-Home-Screen onboarding lives inside the push opt-in flow — there is no install campaign beyond it. Android and desktop browsers subscribe with no install.

## Considered Options

- **No manifest — push stays Android/desktop-only**: rejected — the service worker must exist for push regardless, so one manifest file is all that stands between iPhone users and push; iPhone Students, Instructors, and Platform Admins would stay on email + in-app.
- **A manifest without `display: standalone`**: rejected — iOS only delivers push to installed web apps whose manifest declares `standalone` (or `fullscreen`); any other display mode installs to nothing.
