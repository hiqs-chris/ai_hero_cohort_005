import { and, eq } from "drizzle-orm";
import {
  devices,
  NotificationChannel,
  notificationPreferences,
  notifications,
} from "~/db/schema";
import { sendEmail, type Email, type MailTransport } from "~/lib/mailer.server";
import {
  appUrl,
  catalog,
  type CatalogEntry,
  type EventKey,
  type PayloadFor,
  type Queryable,
} from "./catalog";
import type { DeviceRow } from "./devices.server";
import { defaultPushTransport, type PushPayload, type PushTransport } from "./push.server";

// ─── The notification pipeline ───
// The only code that sends anything. Two phases: emit plans inside the domain
// transaction — it resolves recipients, gates channels through the preference
// matrix, renders every channel, and writes the immutable snapshot rows —
// and deliver sends after the transaction commits, best-effort. See
// docs/specs/notifications.md and ADR-0018.

export type SendPlan = {
  eventKey: EventKey;
  emails: Email[];
  pushes: { device: DeviceRow; payload: PushPayload }[];
};

/**
 * Plans one event's deliveries and writes its in-app snapshot rows, inside
 * the happening's transaction. Transactional Events ignore the preference
 * matrix: email and the in-app list always, never push. Notification Events
 * gate each channel on the recipient's sparse off-rows, and a push carries
 * the notification id where a row was written.
 */
export function emit<K extends EventKey>(
  tx: Queryable,
  eventKey: K,
  payload: PayloadFor<K>
): SendPlan {
  // The registry keys each entry to its payload type, so this entry takes
  // PayloadFor<K>; the one correlated cast the typing needs.
  const entry = catalog[eventKey] as CatalogEntry<PayloadFor<K>>;

  const recipients = entry.recipients(tx, payload);
  const inApp = entry.renderInApp(payload);

  const emails: Email[] = [];
  const pushes: SendPlan["pushes"] = [];

  for (const recipient of recipients) {
    // One preferences query per (recipient, event): the off-rows for this
    // event, whatever channels they name. Absence means on.
    const offChannels =
      entry.kind === "notification"
        ? new Set(
            tx
              .select({ channel: notificationPreferences.channel })
              .from(notificationPreferences)
              .where(
                and(
                  eq(notificationPreferences.userId, recipient.id),
                  eq(notificationPreferences.eventKey, entry.key)
                )
              )
              .all()
              .map((row) => row.channel)
          )
        : new Set<NotificationChannel>();

    // The snapshot row exists only when the in-app cell is on; a push to a
    // user with no row carries no notification id.
    let notificationId: number | null = null;
    if (!offChannels.has(NotificationChannel.InApp)) {
      notificationId = tx
        .insert(notifications)
        .values({
          userId: recipient.id,
          eventKey: entry.key,
          title: inApp.title,
          body: inApp.body,
          link: inApp.link,
        })
        .returning({ id: notifications.id })
        .get().id;
    }

    if (!offChannels.has(NotificationChannel.Email)) {
      const email = entry.renderEmail(payload, recipient);
      emails.push({ to: recipient.email, ...email });
    }

    if (
      entry.kind === "notification" &&
      !offChannels.has(NotificationChannel.Push)
    ) {
      // renderPush omitted means push reuses the in-app render's words.
      const render = entry.renderPush?.(payload) ?? inApp;
      const userDevices = tx
        .select()
        .from(devices)
        .where(eq(devices.userId, recipient.id))
        .all();
      for (const device of userDevices) {
        pushes.push({
          device,
          payload: {
            title: render.title,
            body: render.body,
            url: `${appUrl()}${inApp.link}`,
            notificationId,
          },
        });
      }
    }
  }

  return { eventKey, emails, pushes };
}

export type DeliveryTransports = {
  mail?: MailTransport;
  push?: PushTransport;
};

/**
 * Sends a plan after the transaction commits. Every send is best-effort: a
 * failure is logged with the event key and recipient and otherwise swallowed,
 * and deliver never throws at its caller — a Postmark outage cannot turn a
 * committed refund decision into a 500. The one write that comes out of
 * delivery: a push returning 404 or 410 deletes exactly that Device row.
 */
export async function deliver(
  db: Queryable,
  plan: SendPlan,
  transports: DeliveryTransports = {}
): Promise<void> {
  for (const email of plan.emails) {
    try {
      await sendEmail(email, transports.mail);
    } catch (error) {
      console.error(
        `[notifications] ${plan.eventKey}: email to ${email.to} failed`,
        error
      );
    }
  }

  const push = transports.push ?? defaultPushTransport();
  for (const { device, payload } of plan.pushes) {
    try {
      const { status } = await push.send(
        { endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth },
        payload
      );
      if (status === 404 || status === 410) {
        db.delete(devices).where(eq(devices.id, device.id)).run();
      }
    } catch (error) {
      console.error(
        `[notifications] ${plan.eventKey}: push to ${device.endpoint} failed`,
        error
      );
    }
  }
}

/**
 * Sends every plan after the transaction commits, best-effort — the loop
 * every route action runs once its happening's transaction has committed.
 */
export async function deliverAll(
  db: Queryable,
  plans: SendPlan[]
): Promise<void> {
  for (const plan of plans) {
    await deliver(db, plan);
  }
}
