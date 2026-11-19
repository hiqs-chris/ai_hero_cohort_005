import { useEffect } from "react";

// The self-healing half of ADR-0015's registration: every authenticated page
// load registers the service worker and, when permission is already granted,
// silently POSTs the held subscription to /devices — so a subscription the
// browser rotated, or a row the server lost, is repaired without asking the
// user to re-enable anything. The visible subscribe prompt is ticket #19's.

// The same browser-and-device label the service worker derives, kept in step
// with public/sw.js: "Safari · iPhone".
function deviceLabel(): string {
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
function subscriptionBody(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint,
    keys: json.keys,
    expirationTime: json.expirationTime ?? null,
    label: deviceLabel(),
  };
}

export function PushRegistration() {
  useEffect(() => {
    let cancelled = false;

    async function registerAndUpsert() {
      if (!("serviceWorker" in navigator)) return;

      // Same script URL and scope resolve to one registration, so this is a
      // no-op after the first load and also picks up a replaced sw.js.
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });

      if (Notification.permission !== "granted") return;

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription || cancelled) return;

      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys) return;

      // Silent: a failure here surfaces nowhere — the next load retries.
      await fetch("/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscriptionBody(subscription)),
      });
    }

    registerAndUpsert().catch(() => {
      // Best-effort by design.
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
