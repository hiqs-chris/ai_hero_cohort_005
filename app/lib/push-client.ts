// The single-gesture subscribe flow of ADR-0015: one user gesture registers
// the service worker, requests permission, subscribes with the VAPID public
// key, and posts the row, all in the one handler — as iOS requires. The
// registration awaits run before the prompt so nothing waits between the
// grant and subscribe. The silent page-load upsert (push-registration.tsx)
// is the self-healing half.

// The same browser-and-device label the service worker derives, kept in step
// with public/sw.js: "Safari · iPhone".
export function deviceLabel(): string {
  const ua = navigator.userAgent;

  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let os = "Device";
  if (/iPhone/.test(ua)) os = "iPhone";
  else if (/iPad/.test(ua)) os = "iPad";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Macintosh/.test(ua)) os = "Mac";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Linux/.test(ua)) os = "Linux";

  return `${browser} · ${os}`;
}

// The browser's PushSubscription flattened to /devices' body: the toJSON
// shape plus the client-derived label.
export function subscriptionBody(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint,
    keys: json.keys,
    expirationTime: json.expirationTime ?? null,
    label: deviceLabel(),
  };
}

// The VAPID public key arrives base64url-encoded; subscribe wants the raw
// bytes.
function applicationServerKey(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  // Typed as Uint8Array<ArrayBuffer>, which pushManager.subscribe demands;
  // Uint8Array.from widens to ArrayBufferLike and fails the BufferSource check.
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// Why the pre-prompt's button did nothing, in the words the UI needs.
export type TurnOnOutcome =
  | "granted" // permission granted, subscribed, row posted
  | "denied" // the browser answered no — unblock instructions
  | "dismissed" // the prompt was swiped away — the button stays available
  | "unsupported" // no service worker / Notification API in this browser
  | "no-key"; // push not configured server-side — the prompt stays hidden

/**
 * The one-gesture turn-on: register the service worker → requestPermission
 * → subscribe with the VAPID key → POST /devices, all inside the caller's
 * click handler. A POST failure is swallowed on purpose — the subscription
 * exists, so the next page load's silent upsert repairs the row. Subscribe
 * failures throw to the caller.
 */
export async function turnOnPush(
  vapidPublicKey: string | null
): Promise<TurnOnOutcome> {
  if (!vapidPublicKey) return "no-key";
  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    return "unsupported";
  }

  // Same script URL and scope resolve to one registration, so this is a
  // no-op when the self-healing path already registered it. Both awaits sit
  // before the prompt on purpose: iOS grants subscribe only the gesture's
  // transient activation, and a cold first run must not spend it here.
  // Registering before a possible denial is harmless — the self-healing
  // path registers on every authenticated page load anyway.
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  const registration = await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "dismissed";

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(vapidPublicKey),
  });

  await fetch("/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscriptionBody(subscription)),
  }).catch(() => {
    // Best-effort by design: the page-load upsert retries.
  });

  return "granted";
}
