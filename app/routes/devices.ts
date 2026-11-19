import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/devices";
import { requireUserId } from "~/lib/access.server";
import { parseJsonBody } from "~/lib/validation";
import { db } from "~/db";
import {
  upsertDevice,
  deleteDevice,
  type DeviceSubscription,
} from "~/lib/notifications/devices.server";

// The registration endpoint for the browser's push subscription: POST
// registers or refreshes one Device (the silent page-load upsert, ADR-0015);
// DELETE unregisters the caller's own. Both are the owner's own act, scoped
// by requireUserId — a foreign endpoint is indistinguishable from a missing
// one (ADR-0016).

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
  expirationTime: z.number().finite().nullish(),
  label: z.string(),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

// The browser's PushSubscription shape flattened to one row: epoch-ms expiry
// becomes ISO text at the edge.
function toSubscription(input: z.infer<typeof subscriptionSchema>): DeviceSubscription {
  return {
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    expirationTime:
      input.expirationTime != null
        ? new Date(input.expirationTime).toISOString()
        : null,
    label: input.label,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);

  if (request.method === "POST") {
    const parsed = await parseJsonBody(request, subscriptionSchema);
    if (!parsed.success) {
      throw data("Invalid parameters", { status: 400 });
    }

    upsertDevice(db, userId, toSubscription(parsed.data));
    return { ok: true };
  }

  if (request.method === "DELETE") {
    const parsed = await parseJsonBody(request, unsubscribeSchema);
    if (!parsed.success) {
      throw data("Invalid parameters", { status: 400 });
    }

    const result = deleteDevice(db, userId, parsed.data.endpoint);
    if (!result.ok) {
      throw data(result.error, { status: result.status });
    }
    return { ok: true };
  }

  throw data("Method not allowed", { status: 405 });
}
