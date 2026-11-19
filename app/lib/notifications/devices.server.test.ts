import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  upsertDevice,
  deleteDevice,
  type DeviceSubscription,
} from "./devices.server";

// Devices are tested database-first: real migrations, in-memory SQLite,
// seeded base data. Upsert semantics are ADR-0015's — keyed on endpoint, so
// a re-registering endpoint refreshes itself and a foreign-owned endpoint
// keeps its owner. Deletes are the owner's own act, like a read (ADR-0016).
type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

const OLD_SEEN = new Date(2025, 0, 1, 0, 0, 0).toISOString();

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

function deviceRow(endpoint: string) {
  return db
    .select()
    .from(schema.devices)
    .where(eq(schema.devices.endpoint, endpoint))
    .get();
}

function subscription(overrides: Partial<DeviceSubscription> = {}) {
  return {
    endpoint: "https://push.example.com/sub/1",
    p256dh: "p256dh-key",
    auth: "auth-key",
    expirationTime: null,
    label: "Safari · iPhone",
    ...overrides,
  };
}

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("upsertDevice", () => {
  it("inserts a new subscription as one Device row", () => {
    const row = upsertDevice(db, base.user.id, subscription());

    expect(row).toMatchObject({
      userId: base.user.id,
      endpoint: "https://push.example.com/sub/1",
      p256dh: "p256dh-key",
      auth: "auth-key",
      expirationTime: null,
      label: "Safari · iPhone",
    });
    expect(row.lastSeenAt).not.toBe(OLD_SEEN);
    expect(deviceRow("https://push.example.com/sub/1")?.id).toBe(row.id);
  });

  it("re-registering the same endpoint refreshes keys, label, expiry, and lastSeenAt", () => {
    const first = upsertDevice(db, base.user.id, {
      ...subscription(),
    });
    // Age the row: the second registration must move lastSeenAt.
    db.update(schema.devices)
      .set({ lastSeenAt: OLD_SEEN })
      .where(eq(schema.devices.id, first.id))
      .run();

    const refreshed = upsertDevice(db, base.user.id, subscription({
      p256dh: "p256dh-rotated",
      auth: "auth-rotated",
      expirationTime: "2026-12-01T00:00:00.000Z",
      label: "Chrome · Desktop",
    }));

    expect(refreshed.id).toBe(first.id);
    expect(refreshed).toMatchObject({
      p256dh: "p256dh-rotated",
      auth: "auth-rotated",
      expirationTime: "2026-12-01T00:00:00.000Z",
      label: "Chrome · Desktop",
    });
    expect(refreshed.lastSeenAt).not.toBe(OLD_SEEN);
    expect(deviceRow("https://push.example.com/sub/1")).toMatchObject({
      id: first.id,
      label: "Chrome · Desktop",
    });
  });

  it("never reassigns a foreign-owned endpoint: the first owner keeps it", () => {
    const other = addOtherStudent();
    const theirs = upsertDevice(db, other.id, subscription());

    const row = upsertDevice(
      db,
      base.user.id,
      subscription({ p256dh: "stolen-p256dh", label: "Attacker · Browser" })
    );

    expect(row.id).toBe(theirs.id);
    expect(row.userId).toBe(other.id);
    expect(row).toMatchObject({
      p256dh: "stolen-p256dh",
      label: "Attacker · Browser",
    });
    // And no second row appeared for the attacker.
    expect(
      db.select().from(schema.devices).all()
    ).toHaveLength(1);
  });
});

describe("deleteDevice", () => {
  it("deletes the owner's own subscription", () => {
    upsertDevice(db, base.user.id, subscription());

    const result = deleteDevice(
      db,
      base.user.id,
      "https://push.example.com/sub/1"
    );

    expect(result).toEqual({ ok: true });
    expect(deviceRow("https://push.example.com/sub/1")).toBeUndefined();
  });

  it("refuses a nonexistent endpoint with a 404", () => {
    const result = deleteDevice(
      db,
      base.user.id,
      "https://push.example.com/sub/none"
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toBe("Device not found");
    }
  });

  it("refuses a foreign-owned endpoint with the same 404, and leaves it", () => {
    const other = addOtherStudent();
    upsertDevice(db, other.id, subscription());

    const result = deleteDevice(
      db,
      base.user.id,
      "https://push.example.com/sub/1"
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
    expect(deviceRow("https://push.example.com/sub/1")?.userId).toBe(other.id);
  });
});
