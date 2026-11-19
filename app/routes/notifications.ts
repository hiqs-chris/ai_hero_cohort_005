import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/notifications";
import { requireUserId } from "~/lib/access.server";
import { parseJsonBody } from "~/lib/validation";
import { db } from "~/db";
import { catalog, isEventKey } from "~/lib/notifications/catalog";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from "~/lib/notifications/inbox.server";

// The surface behind the bell: GET serves the recipient's list and unread
// count; POST writes the recipient's own read act — one row by id, or
// Mark all read — and answers with the same shape. Read semantics are
// ADR-0016's: only the recipient's own act reads a row.

const markReadSchema = z.union([
  z.object({ id: z.number().int() }),
  z.object({ all: z.literal(true) }),
]);

function present(row: NotificationRow) {
  return {
    id: row.id,
    eventKey: row.eventKey,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: row.readAt,
    createdAt: row.createdAt,
    // The catalog is the single source of row icons; "Bell" is the bell's
    // own fallback name for an unknown one.
    icon: isEventKey(row.eventKey) ? catalog[row.eventKey].icon : "Bell",
  };
}

function respond(userId: number) {
  return {
    notifications: listNotifications(db, userId).map(present),
    unreadCount: countUnreadNotifications(db, userId),
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  return respond(userId);
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);

  const parsed = await parseJsonBody(request, markReadSchema);
  if (!parsed.success) {
    throw data("Invalid parameters", { status: 400 });
  }

  const now = new Date();
  if ("id" in parsed.data) {
    const result = markNotificationRead(db, parsed.data.id, userId, now);
    if (!result.ok) {
      throw data(result.error, { status: result.status });
    }
  } else {
    markAllNotificationsRead(db, userId, now);
  }

  return respond(userId);
}
