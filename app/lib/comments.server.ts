import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules, users, UserRole } from "~/db/schema";
import { MIN_COMMENT_LENGTH, MAX_COMMENT_LENGTH } from "~/lib/comments";
import { emit, type SendPlan } from "~/lib/notifications/emit.server";
import type { Queryable } from "~/lib/notifications/catalog";

// ─── Comments ───
// Everything about creating a Comment: the body rules and the one-level-deep
// reply tree. Both creation surfaces — the lesson page and the instructor
// question queue — go through this module, so the rules live once. This is
// also where the question.asked birth rule and its transaction will land
// (docs/specs/notifications.md).
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

type Comment = typeof comments.$inferSelect;

function getCourseForLesson(db: Queryable, lessonId: number) {
  return db
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
      lessonTitle: lessons.title,
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
 * top-level Comment on the same lesson. Runs in a transaction (a passed Tx
 * opens a nested savepoint — same commit boundary) so the comment insert and
 * its question.asked snapshot rows commit together; the SendPlans come out for
 * the route to deliver after commit.
 */
export function createComment(
  db: Queryable,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string
): { comment: Comment; plans: SendPlan[] } {
  const run = (tx: Queryable): { comment: Comment; plans: SendPlan[] } => {
    const trimmed = body.trim();
    if (trimmed.length < MIN_COMMENT_LENGTH) {
      throw new Error("Comment cannot be empty");
    }
    if (trimmed.length > MAX_COMMENT_LENGTH) {
      throw new Error(
        `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
      );
    }

    const course = getCourseForLesson(tx, lessonId);
    if (!course) {
      throw new Error("Lesson not found");
    }

    if (parentId !== null) {
      const parent = getCommentById(tx, parentId);
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

    const comment = tx
      .insert(comments)
      .values({ userId, lessonId, parentId, body: trimmed })
      .returning()
      .get();

    // The birth rule: only a top-level comment by a real, non-Admin,
    // non-instructor-of-record counts as a question the instructor should
    // hear about. Replies, instructor's own posts, and Platform Admin posts
    // stay silent.
    const plans: SendPlan[] = [];
    if (parentId === null) {
      const author = tx.select().from(users).where(eq(users.id, userId)).get();
      if (
        author &&
        author.role !== UserRole.Admin &&
        userId !== course.instructorId
      ) {
        plans.push(
          emit(tx, "question.asked", {
            instructorId: course.instructorId,
            courseTitle: course.courseTitle,
            lessonTitle: course.lessonTitle,
            askerName: author.name,
            question: trimmed,
          })
        );
      }
    }

    return { comment, plans };
  };

  return "transaction" in db ? db.transaction(run) : run(db);
}
