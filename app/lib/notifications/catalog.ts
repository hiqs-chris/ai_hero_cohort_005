import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { RefundStatus, UserRole, users } from "~/db/schema";
import { formatPrice } from "~/lib/utils";

// ─── The Notification Catalog ───
// One entry per event Cadence tells people about. The catalog is code:
// adding a happening is adding an entry — no migration follows, and a new
// event appears in Settings with no backfill. Kind lives here, never in the
// database; rows reference events by event_key text. See
// docs/specs/notifications.md and GLOSSARY.md.

// The handle the catalog resolves recipients through: the domain transaction
// while emitting, any db in tests.
type Db = BetterSQLite3Database<typeof schema>;
export type Queryable = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export type UserRow = typeof users.$inferSelect;

/** The deployment origin for email links and push URLs. In-app links stay relative. */
export function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:5173";
}

export type EventKind = "transactional" | "notification";

export type CatalogEntry<P> = {
  key: string;
  kind: EventKind;
  // Notification Events only. Omitted means every role gets a Settings card;
  // Settings filters on it at runtime, so a role change or a new entry needs
  // no backfill.
  roles?: UserRole[];
  icon: string; // a lucide icon name, for the in-app list row
  audience: string; // Settings card line: who the event is addressed to
  blurb: string; // Settings card line: what the event reports
  recipients(tx: Queryable, payload: P): UserRow[];
  renderInApp(payload: P): { title: string; body: string; link: string };
  // renderEmail also takes the recipient: a Notification Event's greeting
  // varies per recipient (the one deviation from the spec's sketch).
  renderEmail(
    payload: P,
    recipient: UserRow
  ): { subject: string; body: string };
  // Notification Events only. Omitted means push reuses the in-app render's
  // title and body.
  renderPush?(payload: P): { title: string; body: string };
};

// ─── Refund Request payloads ───

// The kind union is defined here rather than imported from refunds.server.ts,
// so the catalog never depends on a domain module (the domain imports the
// pipeline, which imports the catalog).
type PurchaseKind = "individual_purchase" | "team_licence";

const PURCHASE_KIND_LABELS: Record<PurchaseKind, string> = {
  individual_purchase: "Individual Purchase",
  team_licence: "Team Licence",
};

export type RefundRequestRaisedPayload = {
  buyerName: string;
  courseTitle: string;
  amountPaid: number;
  purchaseKind: PurchaseKind;
  reason: string;
};

export type RefundRequestReceivedPayload = {
  buyerId: number;
  courseTitle: string;
  amountPaid: number;
};

export type RefundRequestDecidedPayload = {
  buyerId: number;
  courseTitle: string;
  amountPaid: number;
  decision: RefundStatus.Approved | RefundStatus.Declined;
  note: string | null;
};

// ─── Question payloads ───

export type QuestionAskedPayload = {
  instructorId: number;
  courseTitle: string;
  lessonTitle: string;
  askerName: string;
  question: string;
};

// ─── The entries ───

const refundRequestRaised: CatalogEntry<RefundRequestRaisedPayload> = {
  key: "refund_request.raised",
  kind: "notification",
  roles: [UserRole.Admin],
  icon: "Receipt",
  audience: "Platform Admins",
  blurb: "A buyer raised a Refund Request",
  recipients(tx) {
    // The review page is a shared queue where the first decision wins and
    // nothing assigns requests, so every Platform Admin is told.
    return tx.select().from(users).where(eq(users.role, UserRole.Admin)).all();
  },
  renderInApp(payload) {
    return {
      title: "Refund request raised",
      body: `${payload.courseTitle} · ${PURCHASE_KIND_LABELS[payload.purchaseKind]} · ${formatPrice(payload.amountPaid)} · ${payload.buyerName}`,
      link: "/admin/refunds",
    };
  },
  renderEmail(payload, recipient) {
    return {
      subject: `New refund request — ${payload.courseTitle}`,
      body: [
        `Hi ${recipient.name},`,
        "",
        `${payload.buyerName} asked for a refund on "${payload.courseTitle}".`,
        "",
        `Purchase: ${PURCHASE_KIND_LABELS[payload.purchaseKind]}`,
        `Amount: ${formatPrice(payload.amountPaid)}`,
        "",
        "Their reason:",
        "",
        `"${payload.reason}"`,
        "",
        "Review it on the refunds page, under Open:",
        `${appUrl()}/admin/refunds`,
        "",
        `Manage your notification settings: ${appUrl()}/settings`,
      ].join("\n"),
    };
  },
};

const refundRequestReceived: CatalogEntry<RefundRequestReceivedPayload> = {
  key: "refund_request.received",
  kind: "transactional",
  icon: "Inbox",
  audience: "you",
  blurb: "We have your refund request",
  recipients(tx, payload) {
    const buyer = tx
      .select()
      .from(users)
      .where(eq(users.id, payload.buyerId))
      .get();
    return buyer ? [buyer] : [];
  },
  renderInApp(payload) {
    return {
      title: "Refund request received",
      body: `"${payload.courseTitle}" · ${formatPrice(payload.amountPaid)}`,
      link: "/settings",
    };
  },
  renderEmail(payload, recipient) {
    // The confirmation the buyer gets when they raise a Refund Request,
    // moved verbatim from raiseRefundRequest. Transactional: no
    // manage-settings footer, ever.
    return {
      subject: `Refund requested — ${payload.courseTitle}`,
      body: [
        `Hi ${recipient.name},`,
        "",
        `We have your refund request for "${payload.courseTitle}".`,
        `The refund is for ${formatPrice(payload.amountPaid)}, the amount you paid.`,
        "",
        "Our team reviews every refund request by hand. You do not need to do anything else — we will email you again when it is done.",
        "",
        "— The Cadence team",
      ].join("\n"),
    };
  },
};

const refundRequestDecided: CatalogEntry<RefundRequestDecidedPayload> = {
  key: "refund_request.decided",
  kind: "transactional",
  icon: "Inbox",
  audience: "you",
  blurb: "Your refund request was decided",
  recipients(tx, payload) {
    const buyer = tx
      .select()
      .from(users)
      .where(eq(users.id, payload.buyerId))
      .get();
    return buyer ? [buyer] : [];
  },
  renderInApp(payload) {
    return {
      title:
        payload.decision === RefundStatus.Approved
          ? "Refund approved"
          : "Refund declined",
      body: `"${payload.courseTitle}" · ${formatPrice(payload.amountPaid)}`,
      link: "/settings",
    };
  },
  renderEmail(payload, recipient) {
    // The decision email, moved verbatim from buildDecisionEmail. One event
    // whose render branches on the outcome: the buyer experiences "my request
    // was decided". Transactional: no manage-settings footer, ever.
    const noteLines = payload.note ? ["", payload.note] : [];

    const middle =
      payload.decision === RefundStatus.Approved
        ? [
            `We have approved your refund request for "${payload.courseTitle}".`,
            `${formatPrice(payload.amountPaid)}, the full amount you paid, is on its way back to you.`,
            ...noteLines,
          ]
        : [
            `We have looked at your refund request for "${payload.courseTitle}" and decided not to refund it.`,
            ...noteLines,
            "",
            "You still have everything you bought. If something changes, you can raise a new refund request.",
          ];

    return {
      subject: `Refund ${payload.decision} — ${payload.courseTitle}`,
      body: [
        `Hi ${recipient.name},`,
        "",
        ...middle,
        "",
        "— The Cadence team",
      ].join("\n"),
    };
  },
};

const questionAsked: CatalogEntry<QuestionAskedPayload> = {
  key: "question.asked",
  kind: "notification",
  roles: [UserRole.Instructor],
  icon: "CircleHelp",
  audience: "the course's instructor",
  blurb: "Someone asked a question on your course",
  recipients(tx, payload) {
    // The question queue is the instructor's own view of their course, so
    // the course's instructor is told — resolved from the payload like the
    // buyer of refund_request.received.
    const instructor = tx
      .select()
      .from(users)
      .where(eq(users.id, payload.instructorId))
      .get();
    return instructor ? [instructor] : [];
  },
  renderInApp(payload) {
    return {
      title: "New question",
      body: `${payload.courseTitle} · ${payload.lessonTitle} · ${payload.askerName}`,
      link: "/instructor/questions",
    };
  },
  renderEmail(payload, recipient) {
    return {
      subject: `New question on ${payload.courseTitle}`,
      body: [
        `Hi ${recipient.name},`,
        "",
        `${payload.askerName} asked a question on "${payload.courseTitle}".`,
        "",
        `Lesson: ${payload.lessonTitle}`,
        "",
        `"${payload.question}"`,
        "",
        "Reply from your question queue, newest first:",
        `${appUrl()}/instructor/questions`,
        "",
        `Manage your notification settings: ${appUrl()}/settings`,
      ].join("\n"),
    };
  },
};

// ─── The registry ───
// satisfies keeps each entry's own payload type, so EventKey and PayloadFor
// stay precise without any.
export const catalog = {
  "refund_request.raised": refundRequestRaised,
  "refund_request.received": refundRequestReceived,
  "refund_request.decided": refundRequestDecided,
  "question.asked": questionAsked,
} satisfies Record<string, CatalogEntry<never>>;

export type EventKey = keyof typeof catalog;

export type PayloadFor<K extends EventKey> =
  typeof catalog[K] extends CatalogEntry<infer P> ? P : never;

/** Narrows an untrusted string to a catalog key. */
export function isEventKey(key: string): key is EventKey {
  return key in catalog;
}
