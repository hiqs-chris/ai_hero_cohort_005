import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { createComment } from "./comments.server";

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
    const comment = ask("  What is a type?  ");

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
    const question = ask("What is a type?");

    const reply = createComment(
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
    const question = ask("What is a type?");
    const reply = createComment(
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
    const question = ask("What is a type?");

    expect(() =>
      createComment(db, base.user.id, otherLessonId, question.id, "Reply here?")
    ).toThrow("Parent comment belongs to a different lesson");
  });

  it("refuses a reply to a comment that does not exist", () => {
    expect(() => ask("Replying to what?", 999)).toThrow(
      "Parent comment not found"
    );
  });
});
