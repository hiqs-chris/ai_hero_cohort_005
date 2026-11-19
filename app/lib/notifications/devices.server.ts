import { and, eq } from "drizzle-orm";
import { devices } from "~/db/schema";
import type { Queryable } from "./catalog";

// ─── Devices ───
// One Device row per push subscription, keyed on its unique endpoint
// (ADR-0015). The silent page-load upsert: a browser re-registering the same
// endpoint refreshes its keys, label, expiry, and last-seen moment — but never
// its owner, because the endpoint belongs to whoever registered it first. See
// docs/specs/notifications.md.

export type DeviceRow = typeof devices.$inferSelect;

/** A subscription as the route hands it over: epoch-ms expiry already ISO text. */
export type DeviceSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: string | null;
  label: string;
};

/**
 * Registers or refreshes one subscription. Keyed on endpoint: the same
 * endpoint re-registering refreshes keys, label, expiration, and lastSeenAt —
 * never user_id, so a foreign-owned endpoint keeps its owner.
 */
export function upsertDevice(
  db: Queryable,
  userId: number,
  subscription: DeviceSubscription
): DeviceRow {
  const now = new Date().toISOString();
  return db
    .insert(devices)
    .values({
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      expirationTime: subscription.expirationTime,
      label: subscription.label,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: devices.endpoint,
      set: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        expirationTime: subscription.expirationTime,
        label: subscription.label,
        lastSeenAt: now,
      },
    })
    .returning()
    .get();
}

export type DeleteDeviceResult =
  | { ok: true }
  | { ok: false; status: 404; error: string };

/**
 * Unregisters one subscription: the owner's own act. Only the owner's row can
 * go — anyone else's endpoint is indistinguishable from a missing one.
 */
export function deleteDevice(
  db: Queryable,
  userId: number,
  endpoint: string
): DeleteDeviceResult {
  const deleted = db
    .delete(devices)
    .where(and(eq(devices.endpoint, endpoint), eq(devices.userId, userId)))
    .returning({ id: devices.id })
    .get();

  if (!deleted) {
    return { ok: false, status: 404, error: "Device not found" };
  }
  return { ok: true };
}
