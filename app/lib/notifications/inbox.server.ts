import { and, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { notifications } from "~/db/schema";
import type { Queryable } from "./catalog";

// ─── The in-app list ───
// The read side of the snapshot rows: the bell's count, the list behind
// it, and the recipient's own acts of reading — click-through or Mark all
// read, never anything that happens to the subject (ADR-0016). Retention
// lives here too: on authenticated page load the signed-in user's Read
// Notifications older than 30 days are deleted; Unread Notifications are
// never deleted, because deleting one would drop a fact its recipient has
// not seen. See docs/specs/notifications.md and GLOSSARY.md.

export type NotificationRow = typeof notifications.$inferSelect;

/** Read Notifications older than this are pruned on authenticated page load. */
export const RETENTION_DAYS = 30;

export function listNotifications(
  db: Queryable,
  userId: number
): NotificationRow[] {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .all();
}

export function countUnreadNotifications(
  db: Queryable,
  userId: number
): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .get();
  return row?.count ?? 0;
}

export type MarkNotificationReadResult =
  | { ok: true; notification: NotificationRow }
  | { ok: false; status: 404; error: string };

/**
 * Reads one Notification: the recipient's own act, click-through. Only the
 * recipient's own row can be read — anyone else's is indistinguishable from
 * a missing one — and an already-read Notification keeps its original read
 * moment.
 */
export function markNotificationRead(
  db: Queryable,
  notificationId: number,
  userId: number,
  now: Date
): MarkNotificationReadResult {
  const existing = db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .get();

  if (!existing || existing.userId !== userId) {
    return { ok: false, status: 404, error: "Notification not found" };
  }

  if (existing.readAt !== null) {
    return { ok: true, notification: existing };
  }

  const read = db
    .update(notifications)
    .set({ readAt: now.toISOString() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId)
      )
    )
    .returning()
    .get();

  if (!read) {
    return { ok: false, status: 404, error: "Notification not found" };
  }

  return { ok: true, notification: read };
}

/**
 * Reads every one of the recipient's Unread Notifications at once: the
 * recipient's own act, Mark all read. Returns how many were read.
 */
export function markAllNotificationsRead(
  db: Queryable,
  userId: number,
  now: Date
): number {
  return db
    .update(notifications)
    .set({ readAt: now.toISOString() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id })
    .all().length;
}

/**
 * Deletes the recipient's Read Notifications older than the retention
 * window, run on authenticated page load. Only the recipient's own rows
 * go, and only Read ones — an Unread Notification is never deleted,
 * because deleting one would drop a fact its recipient has not seen.
 * Returns how many were deleted.
 */
export function pruneReadNotifications(
  db: Queryable,
  userId: number,
  now: Date
): number {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return db
    .delete(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        isNotNull(notifications.readAt),
        lt(notifications.readAt, cutoff.toISOString())
      )
    )
    .returning({ id: notifications.id })
    .all().length;
}
