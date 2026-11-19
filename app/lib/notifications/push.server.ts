// ─── Push transport ───
// Real Web Push goes through the web-push library when every VAPID_* env
// variable is set; otherwise every push send is a no-op that logs, mirroring
// the mailer's outbox fallback. The transport reports failures as a status
// result, not a throw: a 404 or 410 means the subscription is gone and the
// caller deletes the Device row.

import { sendNotification, WebPushError } from "web-push";

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

export type VapidDetails = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

export function webPushTransport(
  vapid: VapidDetails,
  send: typeof sendNotification = sendNotification
): PushTransport {
  return {
    async send(subscription, payload) {
      try {
        await send(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
          { vapidDetails: vapid }
        );
        return { status: 200 };
      } catch (error) {
        if (error instanceof WebPushError) {
          return { status: error.statusCode };
        }
        console.error(
          `[push] send failed for ${subscription.endpoint}`,
          error
        );
        return { status: 500 };
      }
    },
  };
}

export function vapidFromEnv(
  env: Record<string, string | undefined> = process.env
): VapidDetails | null {
  const subject = env.VAPID_SUBJECT;
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}

export function noopPushTransport(): PushTransport {
  return {
    async send(subscription, payload) {
      console.log(`[push:noop] ${payload.title} → ${subscription.endpoint}`);
      return { status: 200 };
    },
  };
}

export function defaultPushTransport(): PushTransport {
  const vapid = vapidFromEnv();
  return vapid ? webPushTransport(vapid) : noopPushTransport();
}
