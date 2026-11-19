// ─── Push transport ───
// Real Web Push lands in a later ticket; until then every push send is a
// no-op that logs, mirroring the mailer's outbox fallback. The transport
// reports failures as a status result, not a throw: a 404 or 410 means the
// subscription is gone and the caller deletes the Device row.

export type PushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  notificationId: number | null; // null when no in-app row was written
};

export interface PushTransport {
  send(
    subscription: PushSubscription,
    payload: PushPayload
  ): Promise<{ status: number }>;
}

export function noopPushTransport(): PushTransport {
  return {
    async send(subscription, payload) {
      console.log(
        `[push:noop] ${payload.title} → ${subscription.endpoint}`
      );
      return { status: 200 };
    },
  };
}

export function defaultPushTransport(): PushTransport {
  return noopPushTransport();
}
