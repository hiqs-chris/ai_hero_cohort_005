import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { NotificationChannel } from "~/db/schema";
import {
  getOffRows,
  setPreferenceOff,
  setPreferenceOn,
} from "./preferences.server";

// Preference writes are tested database-first: real migrations, in-memory
// SQLite, seeded base data. The off-row is the only state — absence means on.
type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("setPreferenceOff", () => {
  it("inserts exactly that cell's off-row", () => {
    setPreferenceOff(
      db,
      base.user.id,
      "question.asked",
      NotificationChannel.Email
    );

    const offRows = getOffRows(db, base.user.id);
    expect(offRows).toHaveLength(1);
    expect(offRows[0]).toMatchObject({
      userId: base.user.id,
      eventKey: "question.asked",
      channel: NotificationChannel.Email,
    });
  });

  it("rejects Transactional Event keys", () => {
    expect(() =>
      setPreferenceOff(
        db,
        base.user.id,
        "refund_request.received",
        NotificationChannel.Email
      )
    ).toThrow(/transactional/i);
  });
});

describe("setPreferenceOn", () => {
  it("deletes the off-row — the cell is on again", () => {
    setPreferenceOff(
      db,
      base.user.id,
      "question.asked",
      NotificationChannel.Email
    );
    setPreferenceOn(
      db,
      base.user.id,
      "question.asked",
      NotificationChannel.Email
    );

    expect(getOffRows(db, base.user.id)).toHaveLength(0);
  });

  it("rejects Transactional Event keys", () => {
    expect(() =>
      setPreferenceOn(
        db,
        base.user.id,
        "refund_request.decided",
        NotificationChannel.InApp
      )
    ).toThrow(/transactional/i);
  });
});

describe("getOffRows", () => {
  it("returns only this user's off-rows — absence means on", () => {
    setPreferenceOff(
      db,
      base.instructor.id,
      "question.asked",
      NotificationChannel.Push
    );

    expect(getOffRows(db, base.user.id)).toHaveLength(0);
    expect(getOffRows(db, base.instructor.id)).toHaveLength(1);
  });
});
