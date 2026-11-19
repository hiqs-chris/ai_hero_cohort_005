import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { NotificationChannel, RefundStatus, UserRole } from "~/db/schema";
import { outboxTransport } from "~/lib/mailer.server";
import type {
  RefundRequestDecidedPayload,
  RefundRequestRaisedPayload,
  RefundRequestReceivedPayload,
} from "./catalog";
import { emit, deliver } from "./emit.server";
import type { PushTransport } from "./push.server";

// The pipeline is tested database-first: real migrations, in-memory SQLite,
// seeded base data. APP_URL is stubbed so push URLs assert exactly.
type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let platformAdmin: typeof schema.users.$inferSelect;
let secondAdmin: typeof schema.users.$inferSelect;

beforeEach(() => {
  vi.stubEnv("APP_URL", "https://cadence.test");
  db = createTestDb();
  base = seedBaseData(db);
  platformAdmin = db
    .insert(schema.users)
    .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
    .returning()
    .get();
  secondAdmin = db
    .insert(schema.users)
    .values({ name: "Sam Admin", email: "sam@example.com", role: UserRole.Admin })
    .returning()
    .get();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function raisedPayload(): RefundRequestRaisedPayload {
  return {
    buyerName: base.user.name,
    courseTitle: base.course.title,
    amountPaid: 7900,
    purchaseKind: "individual_purchase",
    reason: "The course is not what I needed.",
  };
}

function receivedPayload(): RefundRequestReceivedPayload {
  return {
    buyerId: base.user.id,
    courseTitle: base.course.title,
    amountPaid: 7900,
  };
}

function decidedPayload(
  decision: RefundStatus.Approved | RefundStatus.Declined,
  note: string | null
): RefundRequestDecidedPayload {
  return {
    buyerId: base.user.id,
    courseTitle: base.course.title,
    amountPaid: 7900,
    decision,
    note,
  };
}

function addDevice(userId: number, endpoint: string) {
  return db
    .insert(schema.devices)
    .values({
      userId,
      endpoint,
      p256dh: "p256dh-key",
      auth: "auth-key",
      label: "Safari · iPhone",
    })
    .returning()
    .get();
}

function turnOff(
  userId: number,
  eventKey: string,
  channel: NotificationChannel
) {
  db.insert(schema.notificationPreferences).values({ userId, eventKey, channel }).run();
}

function notificationRows(userId: number) {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .all();
}

describe("emit", () => {
  describe("recipient resolution", () => {
    it("tells every Platform Admin about a raised Refund Request", () => {
      const plan = emit(db, "refund_request.raised", raisedPayload());

      expect(notificationRows(platformAdmin.id)).toHaveLength(1);
      expect(notificationRows(secondAdmin.id)).toHaveLength(1);
      expect(notificationRows(base.user.id)).toHaveLength(0);
      expect(plan.emails.map((email) => email.to)).toEqual(
        expect.arrayContaining(["pat@example.com", "sam@example.com"])
      );
      expect(plan.emails).toHaveLength(2);
    });

    it("tells the buyer their Refund Request was received", () => {
      const plan = emit(db, "refund_request.received", receivedPayload());

      expect(notificationRows(base.user.id)).toHaveLength(1);
      expect(plan.emails.map((email) => email.to)).toEqual(["test@example.com"]);
      expect(plan.pushes).toHaveLength(0);
    });

    it("tells the buyer their Refund Request was decided", () => {
      const plan = emit(
        db,
        "refund_request.decided",
        decidedPayload(RefundStatus.Approved, null)
      );

      expect(notificationRows(base.user.id)).toHaveLength(1);
      expect(plan.emails.map((email) => email.to)).toEqual(["test@example.com"]);
      expect(plan.pushes).toHaveLength(0);
    });
  });

  describe("the preference matrix", () => {
    it("suppresses exactly the channel a turned-off cell gates", () => {
      turnOff(platformAdmin.id, "refund_request.raised", NotificationChannel.Email);
      addDevice(platformAdmin.id, "https://push.example/pat");

      const plan = emit(db, "refund_request.raised", raisedPayload());

      expect(plan.emails.map((email) => email.to)).toEqual(["sam@example.com"]);
      expect(notificationRows(platformAdmin.id)).toHaveLength(1);
      expect(
        plan.pushes.filter((push) => push.device.userId === platformAdmin.id)
      ).toHaveLength(1);
    });

    it("writes no snapshot row when the in-app cell is off, but email and push still run", () => {
      turnOff(platformAdmin.id, "refund_request.raised", NotificationChannel.InApp);
      const device = addDevice(platformAdmin.id, "https://push.example/pat");

      const plan = emit(db, "refund_request.raised", raisedPayload());

      expect(notificationRows(platformAdmin.id)).toHaveLength(0);
      expect(plan.emails.map((email) => email.to)).toContain("pat@example.com");
      const push = plan.pushes.find((candidate) => candidate.device.id === device.id);
      expect(push?.payload.notificationId).toBeNull();
    });

    it("pushes to a Device with the notification id and an absolute URL", () => {
      const device = addDevice(platformAdmin.id, "https://push.example/pat");

      const plan = emit(db, "refund_request.raised", raisedPayload());

      const row = notificationRows(platformAdmin.id)[0];
      const push = plan.pushes.find((candidate) => candidate.device.id === device.id);
      expect(push?.payload).toEqual({
        title: "Refund request raised",
        body: "Test Course · Individual Purchase · $79.00 · Test User",
        url: "https://cadence.test/admin/refunds",
        notificationId: row.id,
      });
    });

    it("emits nothing for a recipient muted on every channel", () => {
      turnOff(platformAdmin.id, "refund_request.raised", NotificationChannel.InApp);
      turnOff(platformAdmin.id, "refund_request.raised", NotificationChannel.Email);
      turnOff(platformAdmin.id, "refund_request.raised", NotificationChannel.Push);
      addDevice(platformAdmin.id, "https://push.example/pat");

      const plan = emit(db, "refund_request.raised", raisedPayload());

      expect(notificationRows(platformAdmin.id)).toHaveLength(0);
      expect(plan.emails.map((email) => email.to)).toEqual(["sam@example.com"]);
      expect(plan.pushes).toHaveLength(0);
    });

    it("ignores the matrix for Transactional Events, never pushes, and carries no footer", () => {
      // Off-rows for a Transactional Event cannot exist through Settings; if
      // one exists anyway, the pipeline ignores it.
      turnOff(base.user.id, "refund_request.received", NotificationChannel.InApp);
      turnOff(base.user.id, "refund_request.received", NotificationChannel.Email);
      turnOff(base.user.id, "refund_request.received", NotificationChannel.Push);
      addDevice(base.user.id, "https://push.example/buyer");

      const plan = emit(db, "refund_request.received", receivedPayload());

      expect(notificationRows(base.user.id)).toHaveLength(1);
      expect(plan.emails.map((email) => email.to)).toEqual(["test@example.com"]);
      expect(plan.pushes).toHaveLength(0);
      expect(plan.emails[0].body).not.toContain("Manage your notification settings");
    });
  });

  describe("snapshot rows", () => {
    it("carries the rendered words at emit for a raised request", () => {
      emit(db, "refund_request.raised", raisedPayload());

      expect(notificationRows(platformAdmin.id)[0]).toMatchObject({
        eventKey: "refund_request.raised",
        title: "Refund request raised",
        body: "Test Course · Individual Purchase · $79.00 · Test User",
        link: "/admin/refunds",
        readAt: null,
      });
    });

    it("carries the rendered words at emit for a receipt", () => {
      emit(db, "refund_request.received", receivedPayload());

      expect(notificationRows(base.user.id)[0]).toMatchObject({
        eventKey: "refund_request.received",
        title: "Refund request received",
        body: '"Test Course" · $79.00',
        link: "/settings",
        readAt: null,
      });
    });
  });
});

describe("deliver", () => {
  it("never throws when a mail or push send fails", async () => {
    const plan = emit(db, "refund_request.raised", raisedPayload());

    await expect(
      deliver(db, plan, {
        mail: {
          async send() {
            throw new Error("Postmark is down");
          },
        },
        push: {
          async send() {
            throw new Error("push service is down");
          },
        },
      })
    ).resolves.toBeUndefined();
  });

  it("deletes exactly the Device row a 404 or 410 push names", async () => {
    const gone404 = addDevice(platformAdmin.id, "https://push.example/gone-404");
    const gone410 = addDevice(platformAdmin.id, "https://push.example/gone-410");
    const staying = addDevice(secondAdmin.id, "https://push.example/staying");

    const plan = emit(db, "refund_request.raised", raisedPayload());
    const push: PushTransport = {
      async send(subscription) {
        if (subscription.endpoint.endsWith("404")) return { status: 404 };
        if (subscription.endpoint.endsWith("410")) return { status: 410 };
        return { status: 200 };
      },
    };

    await deliver(db, plan, {
      push,
      mail: {
        async send() {},
      },
    });

    const deviceIds = db
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .all()
      .map((row) => row.id);
    expect(deviceIds).not.toContain(gone404.id);
    expect(deviceIds).not.toContain(gone410.id);
    expect(deviceIds).toContain(staying.id);
  });

  it("sends each email through the mailer", async () => {
    const directory = mkdtempSync(join(tmpdir(), "outbox-"));
    const plan = emit(db, "refund_request.received", receivedPayload());

    await deliver(db, plan, { mail: outboxTransport(directory) });

    const files = readdirSync(directory);
    expect(files).toHaveLength(1);
    const written = JSON.parse(readFileSync(join(directory, files[0]), "utf8"));
    expect(written).toMatchObject({
      to: "test@example.com",
      subject: "Refund requested — Test Course",
      body: expect.stringContaining(
        "The refund is for $79.00, the amount you paid."
      ),
    });
  });
});
