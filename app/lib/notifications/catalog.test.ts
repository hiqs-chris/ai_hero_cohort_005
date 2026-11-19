import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RefundStatus, UserRole } from "~/db/schema";
import {
  catalog,
  type QuestionAskedPayload,
  type RefundRequestDecidedPayload,
  type RefundRequestRaisedPayload,
  type RefundRequestReceivedPayload,
} from "./catalog";

// The catalog's renders are pure functions of the payload. APP_URL is the one
// outside input, stubbed so the link lines assert exactly.
beforeEach(() => {
  vi.stubEnv("APP_URL", "https://cadence.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function aUser(name: string, email: string) {
  return {
    id: 1,
    name,
    email,
    role: UserRole.Admin,
    avatarUrl: null,
    bio: null,
    createdAt: "2026-10-01T09:00:00.000Z",
  };
}

describe("refund_request.raised", () => {
  const entry = catalog["refund_request.raised"];

  const raised: RefundRequestRaisedPayload = {
    buyerName: "Liam Buyer",
    courseTitle: "Test Course",
    amountPaid: 23700,
    purchaseKind: "team_licence",
    reason: "It just is not working for my team.",
  };

  it("renders the in-app row with the purchase kind, price, and buyer", () => {
    expect(entry.renderInApp(raised)).toEqual({
      title: "Refund request raised",
      body: "Test Course · Team Licence · $237.00 · Liam Buyer",
      link: "/admin/refunds",
    });
  });

  it("labels an Individual Purchase in both renders", () => {
    const individual: RefundRequestRaisedPayload = {
      ...raised,
      purchaseKind: "individual_purchase",
    };

    expect(entry.renderInApp(individual).body).toBe(
      "Test Course · Individual Purchase · $237.00 · Liam Buyer"
    );
    expect(
      entry.renderEmail(individual, aUser("Pat Admin", "pat@example.com")).body
    ).toContain("Purchase: Individual Purchase");
  });

  it("renders the admin email, ending with the manage-settings footer", () => {
    expect(entry.renderEmail(raised, aUser("Pat Admin", "pat@example.com"))).toEqual({
      subject: "New refund request — Test Course",
      body: [
        "Hi Pat Admin,",
        "",
        'Liam Buyer asked for a refund on "Test Course".',
        "",
        "Purchase: Team Licence",
        "Amount: $237.00",
        "",
        "Their reason:",
        "",
        '"It just is not working for my team."',
        "",
        "Review it on the refunds page, under Open:",
        "https://cadence.test/admin/refunds",
        "",
        "Manage your notification settings: https://cadence.test/settings",
      ].join("\n"),
    });
  });

  it("defaults push to the in-app render", () => {
    expect(entry.renderPush).toBeUndefined();
  });
});

describe("refund_request.received", () => {
  const entry = catalog["refund_request.received"];

  const received: RefundRequestReceivedPayload = {
    buyerId: 7,
    courseTitle: "Test Course",
    amountPaid: 7900,
  };

  it("renders the in-app row", () => {
    expect(entry.renderInApp(received)).toEqual({
      title: "Refund request received",
      body: '"Test Course" · $79.00',
      link: "/settings",
    });
  });

  it("renders the buyer email with no manage-settings footer", () => {
    const email = entry.renderEmail(received, aUser("Liam Buyer", "liam@example.com"));

    expect(email.subject).toBe("Refund requested — Test Course");
    expect(email.body).toBe(
      [
        "Hi Liam Buyer,",
        "",
        'We have your refund request for "Test Course".',
        "The refund is for $79.00, the amount you paid.",
        "",
        "Our team reviews every refund request by hand. You do not need to do anything else — we will email you again when it is done.",
        "",
        "— The Cadence team",
      ].join("\n")
    );
    expect(email.body).not.toContain("Manage your notification settings");
  });
});

describe("refund_request.decided", () => {
  const entry = catalog["refund_request.decided"];

  const approved: RefundRequestDecidedPayload = {
    buyerId: 7,
    courseTitle: "Test Course",
    amountPaid: 7900,
    decision: RefundStatus.Approved,
    note: null,
  };

  it("renders the approved in-app row", () => {
    expect(entry.renderInApp(approved)).toEqual({
      title: "Refund approved",
      body: '"Test Course" · $79.00',
      link: "/settings",
    });
  });

  it("renders the declined in-app row", () => {
    const declined: RefundRequestDecidedPayload = {
      ...approved,
      decision: RefundStatus.Declined,
      note: "You finished the course.",
    };

    expect(entry.renderInApp(declined)).toEqual({
      title: "Refund declined",
      body: '"Test Course" · $79.00',
      link: "/settings",
    });
  });

  it("renders the approved email without a note", () => {
    const email = entry.renderEmail(approved, aUser("Liam Buyer", "liam@example.com"));

    expect(email.subject).toBe("Refund approved — Test Course");
    expect(email.body).toBe(
      [
        "Hi Liam Buyer,",
        "",
        'We have approved your refund request for "Test Course".',
        "$79.00, the full amount you paid, is on its way back to you.",
        "",
        "— The Cadence team",
      ].join("\n")
    );
    expect(email.body).not.toContain("Manage your notification settings");
  });

  it("includes the Platform Admin's note in the approved email", () => {
    const withNote: RefundRequestDecidedPayload = {
      ...approved,
      note: "Processed on October invoices.",
    };

    expect(
      entry.renderEmail(withNote, aUser("Liam Buyer", "liam@example.com")).body
    ).toBe(
      [
        "Hi Liam Buyer,",
        "",
        'We have approved your refund request for "Test Course".',
        "$79.00, the full amount you paid, is on its way back to you.",
        "",
        "Processed on October invoices.",
        "",
        "— The Cadence team",
      ].join("\n")
    );
  });

  it("renders the declined email with its required note", () => {
    const declined: RefundRequestDecidedPayload = {
      ...approved,
      decision: RefundStatus.Declined,
      note: "You finished the course.",
    };

    const email = entry.renderEmail(declined, aUser("Liam Buyer", "liam@example.com"));

    expect(email.subject).toBe("Refund declined — Test Course");
    expect(email.body).toBe(
      [
        "Hi Liam Buyer,",
        "",
        'We have looked at your refund request for "Test Course" and decided not to refund it.',
        "",
        "You finished the course.",
        "",
        "You still have everything you bought. If something changes, you can raise a new refund request.",
        "",
        "— The Cadence team",
      ].join("\n")
    );
  });

  it("renders the declined email even without a note", () => {
    const declined: RefundRequestDecidedPayload = {
      ...approved,
      decision: RefundStatus.Declined,
      note: null,
    };

    expect(
      entry.renderEmail(declined, aUser("Liam Buyer", "liam@example.com")).body
    ).toBe(
      [
        "Hi Liam Buyer,",
        "",
        'We have looked at your refund request for "Test Course" and decided not to refund it.',
        "",
        "You still have everything you bought. If something changes, you can raise a new refund request.",
        "",
        "— The Cadence team",
      ].join("\n")
    );
  });
});

describe("question.asked", () => {
  const entry = catalog["question.asked"];

  const asked: QuestionAskedPayload = {
    instructorId: 4,
    courseTitle: "Test Course",
    lessonTitle: "First Lesson",
    askerName: "Liam Buyer",
    question: "What is a type?",
  };

  it("renders the in-app row with the lesson and asker", () => {
    expect(entry.renderInApp(asked)).toEqual({
      title: "New question",
      body: "Test Course · First Lesson · Liam Buyer",
      link: "/instructor/questions",
    });
  });

  it("renders the instructor email, ending with the manage-settings footer", () => {
    expect(
      entry.renderEmail(asked, aUser("Test Instructor", "instructor@example.com"))
    ).toEqual({
      subject: "New question on Test Course",
      body: [
        "Hi Test Instructor,",
        "",
        'Liam Buyer asked a question on "Test Course".',
        "",
        "Lesson: First Lesson",
        "",
        '"What is a type?"',
        "",
        "Reply from your question queue, newest first:",
        "https://cadence.test/instructor/questions",
        "",
        "Manage your notification settings: https://cadence.test/settings",
      ].join("\n"),
    });
  });

  it("defaults push to the in-app render", () => {
    expect(entry.renderPush).toBeUndefined();
  });
});
