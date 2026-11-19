import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { comments, courses, lessons, modules } from "~/db/schema";
import { MIN_COMMENT_LENGTH, MAX_COMMENT_LENGTH } from "~/lib/comments";

// ─── Comments ───
// Everything about creating a Comment: the body rules and the one-level-deep
// reply tree. Both creation surfaces — the lesson page and the instructor
// question queue — go through this module, so the rules live once. This is
// also where the question.asked birth rule and its transaction will land
// (docs/specs/notifications.md).
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

export type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

type Comment = typeof comments.$inferSelect;

function getCourseForLesson(db: Queryable, lessonId: number) {
  return db
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

function getCommentById(db: Queryable, commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

/**
 * Creates a top-level Comment or a one-level-deep Reply on a lesson. The body
 * is trimmed, then must be 1–5000 characters. A Reply's parent must be a
 * top-level Comment on the same lesson.
 */
export function createComment(
  db: Queryable,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string
): Comment {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }

  const course = getCourseForLesson(db, lessonId);
  if (!course) {
    throw new Error("Lesson not found");
  }

  if (parentId !== null) {
    const parent = getCommentById(db, parentId);
    if (!parent) {
      throw new Error("Parent comment not found");
    }
    if (parent.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
    if (parent.parentId !== null) {
      throw new Error("Replies can only be one level deep");
    }
  }

  return db
    .insert(comments)
    .values({ userId, lessonId, parentId, body: trimmed })
    .returning()
    .get();
}
