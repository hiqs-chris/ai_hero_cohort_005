import { useEffect } from "react";
import { subscriptionBody } from "~/lib/push-client";

// The self-healing half of ADR-0015's registration: every authenticated page
// load registers the service worker and, when permission is already granted,
// silently POSTs the held subscription to /devices — so a subscription the
// browser rotated, or a row the server lost, is repaired without asking the
// user to re-enable anything. The visible subscribe prompt is ticket #19's
// (app/components/push-pre-prompt.tsx, via turnOnPush in push-client.ts).
//
// Both effects wait for `authenticated`: a subscription needs an owner, and
// a signed-out mark-read POST has none — it would only 401. So logged-out
// pages never even register the worker.

export function PushRegistration({
  authenticated,
}: {
  authenticated: boolean;
}) {
  useEffect(() => {
    if (!authenticated) return;

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
  }, [authenticated]);

  // A clicked notification opens the app with ?notification=<id> (public/sw.js
  // appends it). Mark that notification read, then strip the param so a
  // refresh or a shared link doesn't re-mark it. Passing window.history.state
  // through keeps React Router's history idx intact.
  useEffect(() => {
    if (!authenticated) return;

    const id = Number(new URLSearchParams(window.location.search).get("notification"));
    if (!Number.isInteger(id) || id <= 0) return;

    fetch("/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
      .catch(() => {
        // Best-effort: an unread that stays unread tries again next visit.
      })
      .finally(() => {
        const search = new URLSearchParams(window.location.search);
        search.delete("notification");
        const query = search.toString();
        const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
        window.history.replaceState(window.history.state, "", url);
      });
  }, [authenticated]);

  return null;
}
