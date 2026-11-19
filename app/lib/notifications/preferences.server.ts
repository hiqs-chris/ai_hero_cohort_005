import { and, eq } from "drizzle-orm";
import { notificationPreferences, NotificationChannel } from "~/db/schema";
import { catalog, type EventKey, type Queryable } from "./catalog";

// The event×channel matrix, written sparse: a cell is on unless its off-row
// exists, so turning a cell on is deleting the row. Writes reject
// Transactional Event keys — those are always sent and never offered as
// cards, so no off-row can exist for one. See docs/specs/notifications.md.

function assertNotificationEvent(eventKey: EventKey): void {
  if (catalog[eventKey].kind === "transactional") {
    throw new Error(
      `"${eventKey}" is a Transactional Event — it has no preferences.`
    );
  }
}

/** Turn one cell off: insert its sparse off-row (idempotent). */
export function setPreferenceOff(
  db: Queryable,
  userId: number,
  eventKey: EventKey,
  channel: NotificationChannel
): void {
  assertNotificationEvent(eventKey);
  db.insert(notificationPreferences)
    .values({ userId, eventKey, channel })
    .onConflictDoNothing()
    .run();
}

/** Turn one cell back on: delete its sparse off-row. */
export function setPreferenceOn(
  db: Queryable,
  userId: number,
  eventKey: EventKey,
  channel: NotificationChannel
): void {
  assertNotificationEvent(eventKey);
  db.delete(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.eventKey, eventKey),
        eq(notificationPreferences.channel, channel)
      )
    )
    .run();
}

/** The user's off-rows — every cell without one is on. */
export function getOffRows(db: Queryable, userId: number) {
  return db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .all();
}
