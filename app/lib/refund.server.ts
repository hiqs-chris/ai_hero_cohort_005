import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { purchases, refunds, RefundStatus } from "~/db/schema";
import type * as schema from "~/db/schema";

// ─── Refund Request decisions ───
// The learner-facing eligibility rules live in the request route; this module
// holds the admin side — approving, declining, and the guard that stops a new
// request once a purchase has been refunded.

// The routes pass the app's `db`; the tests pass a `createTestDb()` instance.
// Both are the same Drizzle shape, so the functions take it as a parameter
// instead of importing the app database.
type RefundsDb = BetterSQLite3Database<typeof schema>;

export type RefundDecisionResult =
  | { ok: true; refund: typeof refunds.$inferSelect }
  | { ok: false; error: "not-found" | "already-resolved" };

function getRefundRequest(db: RefundsDb, refundId: number) {
  return db.select().from(refunds).where(eq(refunds.id, refundId)).get();
}

/**
 * True once a purchase's refund has been approved. The money is already back
 * with the learner, so no new Refund Request can be raised for it. A declined
 * request does not count — the learner may ask again.
 */
export function hasApprovedRefundRequest(
  db: RefundsDb,
  purchaseId: number
): boolean {
  const approved = db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.purchaseId, purchaseId),
        eq(refunds.status, RefundStatus.Approved)
      )
    )
    .get();
  return approved !== undefined;
}

/**
 * Approves an open Refund Request. A Refund is always the full amount the
 * learner paid — there are no partial refunds.
 */
export function approveRefundRequest(
  db: RefundsDb,
  input: { refundId: number; resolvedByUserId: number }
): RefundDecisionResult {
  const refund = getRefundRequest(db, input.refundId);
  if (!refund) return { ok: false, error: "not-found" };

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, refund.purchaseId))
    .get();
  if (!purchase) return { ok: false, error: "not-found" };

  // Decisions are final. The where clause re-checks the status so the update
  // cannot land if another admin resolved the request first.
  const approved = db
    .update(refunds)
    .set({
      status: RefundStatus.Approved,
      amountRefunded: purchase.amountPaid,
      resolvedAt: new Date().toISOString(),
      resolvedByUserId: input.resolvedByUserId,
    })
    .where(
      and(eq(refunds.id, refund.id), eq(refunds.status, RefundStatus.Open))
    )
    .returning()
    .get();

  if (!approved) return { ok: false, error: "already-resolved" };
  return { ok: true, refund: approved };
}

/**
 * Declines an open Refund Request and records the Decline Note. The note is
 * written to the learner, so it must say why in words they can read.
 */
export function declineRefundRequest(
  db: RefundsDb,
  input: { refundId: number; resolvedByUserId: number; declineNote: string }
): RefundDecisionResult {
  const refund = getRefundRequest(db, input.refundId);
  if (!refund) return { ok: false, error: "not-found" };

  // Decisions are final. Same race guard as an approval.
  const declined = db
    .update(refunds)
    .set({
      status: RefundStatus.Declined,
      declineNote: input.declineNote,
      resolvedAt: new Date().toISOString(),
      resolvedByUserId: input.resolvedByUserId,
    })
    .where(
      and(eq(refunds.id, refund.id), eq(refunds.status, RefundStatus.Open))
    )
    .returning()
    .get();

  if (!declined) return { ok: false, error: "already-resolved" };
  return { ok: true, refund: declined };
}
