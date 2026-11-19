import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "../test/setup";
import {
  approveRefundRequest,
  declineRefundRequest,
  hasApprovedRefundRequest,
} from "./refund.server";
import {
  purchases,
  refunds,
  RefundStatus,
  users,
  UserRole,
} from "~/db/schema";

// One admin, one learner with an open Refund Request on a paid purchase.
function setupOpenRefundRequest() {
  const testDb = createTestDb();
  const base = seedBaseData(testDb);

  if (!base.user || !base.course) {
    throw new Error("Base seed data is missing.");
  }

  const admin = testDb
    .insert(users)
    .values({
      name: "Test Admin",
      email: "admin@example.com",
      role: UserRole.Admin,
    })
    .returning()
    .get();
  if (!admin) throw new Error("Failed to create the admin fixture.");

  const purchase = testDb
    .insert(purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: 7900,
      country: "US",
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get();
  if (!purchase) throw new Error("Failed to create the purchase fixture.");

  const refund = testDb
    .insert(refunds)
    .values({
      purchaseId: purchase.id,
      status: RefundStatus.Open,
      reason: "Not what I expected.",
    })
    .returning()
    .get();
  if (!refund) throw new Error("Failed to create the refund fixture.");

  return { testDb, admin, purchase, refund };
}

function getSavedRefund(testDb: ReturnType<typeof createTestDb>, refundId: number) {
  return testDb
    .select()
    .from(refunds)
    .where(eq(refunds.id, refundId))
    .get();
}

describe("approveRefundRequest", () => {
  it("approves an open request for the full amount paid", () => {
    const { testDb, admin, purchase, refund } = setupOpenRefundRequest();

    const result = approveRefundRequest(testDb, {
      refundId: refund.id,
      resolvedByUserId: admin.id,
    });

    expect(result.ok).toBe(true);

    const saved = getSavedRefund(testDb, refund.id);
    expect(saved?.status).toBe(RefundStatus.Approved);
    expect(saved?.amountRefunded).toBe(purchase.amountPaid);
    expect(saved?.resolvedByUserId).toBe(admin.id);
    expect(Number.isNaN(Date.parse(saved?.resolvedAt ?? ""))).toBe(false);
  });

  it("fails when the request does not exist", () => {
    const { testDb, admin } = setupOpenRefundRequest();

    const result = approveRefundRequest(testDb, {
      refundId: 9999,
      resolvedByUserId: admin.id,
    });

    expect(result).toEqual({ ok: false, error: "not-found" });
  });

  it("does not overwrite an earlier decision", () => {
    const { testDb, admin, refund } = setupOpenRefundRequest();

    declineRefundRequest(testDb, {
      refundId: refund.id,
      resolvedByUserId: admin.id,
      declineNote: "You had already finished the course.",
    });

    const result = approveRefundRequest(testDb, {
      refundId: refund.id,
      resolvedByUserId: admin.id,
    });

    expect(result).toEqual({ ok: false, error: "already-resolved" });

    const saved = getSavedRefund(testDb, refund.id);
    expect(saved?.status).toBe(RefundStatus.Declined);
    expect(saved?.amountRefunded).toBeNull();
  });
});

describe("declineRefundRequest", () => {
  it("declines an open request and records the Decline Note", () => {
    const { testDb, admin, refund } = setupOpenRefundRequest();
    const declineNote = "You had already finished the course.";

    const result = declineRefundRequest(testDb, {
      refundId: refund.id,
      resolvedByUserId: admin.id,
      declineNote,
    });

    expect(result.ok).toBe(true);

    const saved = getSavedRefund(testDb, refund.id);
    expect(saved?.status).toBe(RefundStatus.Declined);
    expect(saved?.declineNote).toBe(declineNote);
    // A declined request refunds nothing.
    expect(saved?.amountRefunded).toBeNull();
    expect(saved?.resolvedByUserId).toBe(admin.id);
    expect(Number.isNaN(Date.parse(saved?.resolvedAt ?? ""))).toBe(false);
  });

  it("cannot decline a request that was already approved", () => {
    const { testDb, admin, refund } = setupOpenRefundRequest();

    approveRefundRequest(testDb, {
      refundId: refund.id,
      resolvedByUserId: admin.id,
    });

    const result = declineRefundRequest(testDb, {
      refundId: refund.id,
      resolvedByUserId: admin.id,
      declineNote: "Too late to matter.",
    });

    expect(result).toEqual({ ok: false, error: "already-resolved" });

    const saved = getSavedRefund(testDb, refund.id);
    expect(saved?.status).toBe(RefundStatus.Approved);
    expect(saved?.declineNote).toBeNull();
  });
});

describe("hasApprovedRefundRequest", () => {
  it("is false while the request is open", () => {
    const { testDb, purchase } = setupOpenRefundRequest();

    expect(hasApprovedRefundRequest(testDb, purchase.id)).toBe(false);
  });

  it("is false when the request was declined — the learner may ask again", () => {
    const { testDb, admin, purchase, refund } = setupOpenRefundRequest();

    declineRefundRequest(testDb, {
      refundId: refund.id,
      resolvedByUserId: admin.id,
      declineNote: "You had already finished the course.",
    });

    expect(hasApprovedRefundRequest(testDb, purchase.id)).toBe(false);
  });

  it("is true once the request is approved", () => {
    const { testDb, admin, purchase, refund } = setupOpenRefundRequest();

    approveRefundRequest(testDb, {
      refundId: refund.id,
      resolvedByUserId: admin.id,
    });

    expect(hasApprovedRefundRequest(testDb, purchase.id)).toBe(true);
  });
});
