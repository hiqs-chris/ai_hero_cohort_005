// Cadence's service worker (ADR-0015): it shows notifications delivered by
// the web-push transport, lands clicks on the notification's link with the
// read-marking param attached, and re-subscribes when the browser rotates the
// subscription — posting the fresh subscription to /devices so the Device row
// keeps pointing at a live endpoint.

// The same browser-and-device label the page's silent upsert derives, kept in
// step with app/components/push-registration.tsx: "Safari · iPhone".
function deviceLabel() {
  var ua = navigator.userAgent;

  var browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";

  var os = "Device";
  if (/iPhone/.test(ua)) os = "iPhone";
  else if (/iPad/.test(ua)) os = "iPad";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Macintosh/.test(ua)) os = "Mac";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Linux/.test(ua)) os = "Linux";

  return browser + " · " + os;
}

// The transport's payload: { title, body, url, notificationId }. A missing or
// unparseable payload still shows a tappable notification.
self.addEventListener("push", function (event) {
  var payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = {};
  }

  var title = payload.title || "Cadence";
  var body = payload.body || "";
  var url = payload.url || "/";
  var notificationId = payload.notificationId != null ? payload.notificationId : null;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      data: { url: url, notificationId: notificationId },
    })
  );
});

// A click focuses an already-open window on the target URL, else opens one.
// With a notificationId the target carries ?notification=<id> so the page
// marks that row read (ADR-0016) and strips the param.
function clickTarget(data) {
  var url = new URL((data && data.url) || "/", self.location.origin);
  if (data && data.notificationId != null) {
    url.searchParams.set("notification", String(data.notificationId));
  }
  return url.href;
}

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  var target = clickTarget(event.notification.data);
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url === target && "focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      })
  );
});

// The browser rotated or dropped the subscription: re-subscribe with the old
// options and post the fresh subscription JSON to /devices. Best-effort —
// the next page load's silent upsert repairs the row if this fails.
self.addEventListener("pushsubscriptionchange", function (event) {
  event.waitUntil(
    (async function () {
      try {
        var options = event.oldSubscription ? event.oldSubscription.options : {};
        var subscription = await self.registration.pushManager.subscribe(options);
        var json = subscription.toJSON();
        // The same /devices body subscriptionBody in app/lib/push-client.ts
        // builds, kept in step with it — the worker cannot import app code.
        await fetch("/devices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: json.keys,
            expirationTime: json.expirationTime != null ? json.expirationTime : null,
            label: deviceLabel(),
          }),
        });
      } catch (e) {
        // The page-load upsert is the backstop.
      }
    })()
  );
});
