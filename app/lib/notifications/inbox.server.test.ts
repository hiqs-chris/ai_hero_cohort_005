import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  pruneReadNotifications,
} from "./inbox.server";

// The in-app list is tested database-first: real migrations, in-memory
// SQLite, seeded base data. Read semantics are ADR-0016's — a Notification
// is read only by its recipient's own act — and retention is the spec's:
// Read Notifications older than 30 days are pruned on authenticated page
// load, Unread Notifications never are.
type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function daysBefore(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

// A snapshot row as emit would have written it, at chosen moments.
function addNotification(
  userId: number,
  createdAt: Date,
  readAt: Date | null
) {
  return db
    .insert(schema.notifications)
    .values({
      userId,
      eventKey: "refund_request.received",
      title: "Refund request received",
      body: `"Intro to Music Production" · $79`,
      link: "/settings",
      readAt: readAt === null ? null : readAt.toISOString(),
      createdAt: createdAt.toISOString(),
    })
    .returning()
    .get();
}

function addOtherStudent() {
  return db
    .insert(schema.users)
    .values({
      name: "Ora Other",
      email: "ora@example.com",
      role: UserRole.Student,
    })
    .returning()
    .get();
}

function notificationRows(userId: number) {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .all();
}

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("listNotifications", () => {
  it("lists the user's notifications newest first, with every field the list shows", () => {
    const older = addNotification(base.user.id, daysBefore(2), null);
    const newer = addNotification(
      base.user.id,
      daysBefore(1),
      daysBefore(1)
    );

    const rows = listNotifications(db, base.user.id);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe(newer.id);
    expect(rows[1]?.id).toBe(older.id);
    expect(rows[0]).toMatchObject({
      eventKey: "refund_request.received",
      title: "Refund request received",
      body: `"Intro to Music Production" · $79`,
      link: "/settings",
      readAt: daysBefore(1).toISOString(),
      createdAt: daysBefore(1).toISOString(),
    });
  });

  it("keeps other users' notifications out of the list", () => {
    const other = addOtherStudent();
    addNotification(other.id, daysBefore(1), null);

    expect(listNotifications(db, base.user.id)).toHaveLength(0);
  });
});

describe("countUnreadNotifications", () => {
  it("counts only the user's Unread Notifications", () => {
    const other = addOtherStudent();
    addNotification(base.user.id, daysBefore(2), null);
    addNotification(base.user.id, daysBefore(1), null);
    addNotification(base.user.id, daysBefore(1), daysBefore(1)); // read
    addNotification(other.id, daysBefore(1), null); // someone else's

    expect(countUnreadNotifications(db, base.user.id)).toBe(2);
  });

  it("counts zero for a user with no notifications", () => {
    expect(countUnreadNotifications(db, base.user.id)).toBe(0);
  });
});

describe("markNotificationRead", () => {
  it("marks the recipient's own Unread Notification read at the given moment", () => {
    const notification = addNotification(base.user.id, daysBefore(1), null);

    const result = markNotificationRead(
      db,
      notification.id,
      base.user.id,
      NOW
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.notification.readAt).toBe(NOW.toISOString());
    }
  });

  it("refuses a notification that is not the recipient's own, and leaves it unread", () => {
    const other = addOtherStudent();
    const notification = addNotification(other.id, daysBefore(1), null);

    const result = markNotificationRead(
      db,
      notification.id,
      base.user.id,
      NOW
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
    const row = db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, notification.id))
      .get();
    expect(row?.readAt).toBeNull();
  });

  it("leaves an already-read notification read at its original moment", () => {
    const notification = addNotification(
      base.user.id,
      daysBefore(2),
      daysBefore(1)
    );

    const result = markNotificationRead(
      db,
      notification.id,
      base.user.id,
      NOW
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.notification.readAt).toBe(daysBefore(1).toISOString());
    }
  });
});

describe("markAllNotificationsRead", () => {
  it("marks every one of the recipient's Unread Notifications read, and no one else's", () => {
    const other = addOtherStudent();
    addNotification(base.user.id, daysBefore(2), null);
    addNotification(base.user.id, daysBefore(1), daysBefore(1)); // already read
    addNotification(base.user.id, daysBefore(1), null);
    addNotification(other.id, daysBefore(1), null);

    const marked = markAllNotificationsRead(db, base.user.id, NOW);

    expect(marked).toBe(2);
    expect(
      notificationRows(base.user.id).every((row) => row.readAt !== null)
    ).toBe(true);
    expect(
      notificationRows(other.id).every((row) => row.readAt === null)
    ).toBe(true);
  });
});

describe("pruneReadNotifications", () => {
  it("deletes the user's Read Notifications older than 30 days, and only those", () => {
    const old = addNotification(base.user.id, daysBefore(36), daysBefore(35));
    const atTheLimit = addNotification(
      base.user.id,
      daysBefore(35),
      daysBefore(30)
    );
    const recent = addNotification(base.user.id, daysBefore(5), daysBefore(5));

    const pruned = pruneReadNotifications(db, base.user.id, NOW);

    expect(pruned).toBe(1);
    const remaining = notificationRows(base.user.id).map((row) => row.id);
    expect(remaining).not.toContain(old.id);
    expect(remaining).toContain(atTheLimit.id);
    expect(remaining).toContain(recent.id);
  });

  it("never deletes an Unread Notification, however old", () => {
    const unread = addNotification(base.user.id, daysBefore(40), null);

    const pruned = pruneReadNotifications(db, base.user.id, NOW);

    expect(pruned).toBe(0);
    const rows = notificationRows(base.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(unread.id);
  });

  it("leaves other users' old Read Notifications alone", () => {
    const other = addOtherStudent();
    const theirs = addNotification(other.id, daysBefore(36), daysBefore(35));

    const pruned = pruneReadNotifications(db, base.user.id, NOW);

    expect(pruned).toBe(0);
    expect(notificationRows(other.id).map((row) => row.id)).toEqual([
      theirs.id,
    ]);
  });
});
