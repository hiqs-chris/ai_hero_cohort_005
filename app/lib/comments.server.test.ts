import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, notificationRows, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { createComment } from "./comments.server";
import { MAX_COMMENT_LENGTH } from "~/lib/comments";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "First Lesson", position: 1 })
    .returning()
    .get().id;

  otherLessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Second Lesson", position: 2 })
    .returning()
    .get().id;
});

function ask(body: string, parentId: number | null = null) {
  return createComment(db, base.user.id, lessonId, parentId, body);
}

describe("creating a comment", () => {
  it("creates a top-level comment with the body trimmed", () => {
    const { comment } = ask("  What is a type?  ");

    expect(comment).toMatchObject({
      userId: base.user.id,
      lessonId,
      parentId: null,
      body: "What is a type?",
    });

    const persisted = db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.id, comment.id))
      .get();
    expect(persisted).toMatchObject({
      userId: base.user.id,
      lessonId,
      parentId: null,
      body: "What is a type?",
    });
  });

  it("creates a reply to a top-level comment", () => {
    const { comment: question } = ask("What is a type?");

    const { comment: reply } = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "A type is a set of values."
    );

    expect(reply).toMatchObject({
      parentId: question.id,
      lessonId,
      body: "A type is a set of values.",
    });
  });

  it("refuses a reply to a reply", () => {
    const { comment: question } = ask("What is a type?");
    const { comment: reply } = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "A type is a set of values."
    );

    expect(() => ask("But what about never?", reply.id)).toThrow(
      "Replies can only be one level deep"
    );
  });

  it("refuses a reply whose parent is on a different lesson", () => {
    const { comment: question } = ask("What is a type?");

    expect(() =>
      createComment(db, base.user.id, otherLessonId, question.id, "Reply here?")
    ).toThrow("Parent comment belongs to a different lesson");
  });

  it("refuses a reply to a comment that does not exist", () => {
    expect(() => ask("Replying to what?", 999)).toThrow(
      "Parent comment not found"
    );
  });

  it("refuses an empty comment", () => {
    expect(() => ask("   ")).toThrow("Comment cannot be empty");

    expect(db.select().from(schema.comments).all()).toHaveLength(0);
  });

  it("refuses a comment past the length limit", () => {
    expect(() => ask("x".repeat(MAX_COMMENT_LENGTH + 1))).toThrow(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  });

  it("accepts a comment at the length limit", () => {
    const { comment } = ask("x".repeat(MAX_COMMENT_LENGTH));

    expect(comment.body).toHaveLength(MAX_COMMENT_LENGTH);
  });

  it("refuses a comment on a lesson that does not exist", () => {
    expect(() =>
      createComment(db, base.user.id, 999, null, "Where am I?")
    ).toThrow("Lesson not found");
  });
});

describe("the question.asked birth rule", () => {
  let colleague: typeof schema.users.$inferSelect;
  let colleagueLessonId: number;

  beforeEach(() => {
    colleague = db
      .insert(schema.users)
      .values({
        name: "Sam Colleague",
        email: "colleague@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();

    const colleagueCourse = db
      .insert(schema.courses)
      .values({
        title: "Colleague Course",
        slug: "colleague-course",
        description: "A colleague's course",
        salesCopy: "## Colleague Course\n\nSales copy for the colleague course.",
        instructorId: colleague.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Published,
      })
      .returning()
      .get();

    const colleagueModule = db
      .insert(schema.modules)
      .values({ courseId: colleagueCourse.id, title: "Advanced", position: 1 })
      .returning()
      .get();

    colleagueLessonId = db
      .insert(schema.lessons)
      .values({
        moduleId: colleagueModule.id,
        title: "Colleague Lesson",
        position: 1,
      })
      .returning()
      .get().id;
  });

  it("tells the instructor when a Student asks a top-level question", () => {
    const { plans } = ask("What is a type?");

    expect(plans.map((plan) => plan.eventKey)).toEqual(["question.asked"]);
    expect(plans[0].emails.map((email) => email.to)).toEqual([
      "instructor@example.com",
    ]);
    expect(plans[0].emails[0].subject).toBe("New question on Test Course");
    expect(notificationRows(db, base.instructor.id)).toMatchObject([
      {
        eventKey: "question.asked",
        title: "New question",
        body: "Test Course · First Lesson · Test User",
        link: "/instructor/questions",
      },
    ]);
  });

  it("tells the colleague, not the asker, when an Instructor asks on a colleague's course", () => {
    const { plans } = createComment(
      db,
      base.instructor.id,
      colleagueLessonId,
      null,
      "How do you scope yours?"
    );

    expect(plans[0].emails.map((email) => email.to)).toEqual([
      "colleague@example.com",
    ]);
    expect(notificationRows(db, colleague.id)).toMatchObject([
      { eventKey: "question.asked" },
    ]);
    expect(notificationRows(db, base.instructor.id)).toHaveLength(0);
  });

  it("never tells anyone for a reply", () => {
    const { comment: question } = createComment(
      db,
      base.instructor.id,
      lessonId,
      null,
      "Office hours start Monday."
    );

    const { plans } = createComment(
      db,
      base.user.id,
      lessonId,
      question.id,
      "Following up on that."
    );

    expect(plans).toEqual([]);
    expect(notificationRows(db, base.instructor.id)).toHaveLength(0);
  });

  it("never tells anyone when a Platform Admin posts", () => {
    const admin = db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();

    const { plans } = createComment(
      db,
      admin.id,
      lessonId,
      null,
      "House rules: be kind."
    );

    expect(plans).toEqual([]);
    expect(notificationRows(db, base.instructor.id)).toHaveLength(0);
  });

  it("never tells the instructor for their own top-level comment", () => {
    const { plans } = createComment(
      db,
      base.instructor.id,
      lessonId,
      null,
      "Welcome to the course."
    );

    expect(plans).toEqual([]);
    expect(notificationRows(db, base.instructor.id)).toHaveLength(0);
  });
});
