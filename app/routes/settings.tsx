import { useRef, useEffect, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/settings";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { UserRole, RefundStatus, users, devices, NotificationChannel } from "~/db/schema";
import { AlertTriangle, Lock } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";
import { db } from "~/db";
import { eq } from "drizzle-orm";
import { formatPrice, formatRelativeTime } from "~/lib/utils";
import { listRefundRequestsForBuyer } from "~/lib/refunds.server";
import { getOffRows, setPreferenceOff, setPreferenceOn } from "~/lib/notifications/preferences.server";
import { PushPrePrompt } from "~/components/push-pre-prompt";
import type { EventKey } from "~/lib/notifications/catalog";

const settingsSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
  bio: z.string().trim().optional(),
});

const preferenceSchema = z.object({
  eventKey: z.string().min(1),
  channel: z.enum([NotificationChannel.InApp, NotificationChannel.Email, NotificationChannel.Push]),
  state: z.enum(["on", "off"]),
});

/** The Settings card title: "question.asked" → "Question asked". */
function cardTitle(key: string): string {
  const title = key.replace(/[._]/g, " ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function meta() {
  return [
    { title: "Settings — Cadence" },
    { name: "description", content: "Edit your profile details" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to edit your details.", {
      status: 401,
    });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser) {
    throw data("User not found.", { status: 404 });
  }

  const refundRequests = listRefundRequestsForBuyer(db, currentUserId);

  // Cards come from the catalog at runtime, filtered to the events this
  // user's role can receive. The catalog is imported dynamically so it never
  // reaches the client bundle.
  const { catalog } = await import("~/lib/notifications/catalog");
  const offRows = getOffRows(db, currentUserId);

  const notificationCards = Object.values(catalog)
    .filter(
      (entry) =>
        entry.kind === "notification" &&
        (!entry.roles || entry.roles.includes(currentUser.role))
    )
    .map((entry) => ({
      key: entry.key,
      title: cardTitle(entry.key),
      audience: entry.audience,
      blurb: entry.blurb,
      offChannels: offRows
        .filter((row) => row.eventKey === entry.key)
        .map((row) => row.channel),
    }));

  const transactionalEvents = Object.values(catalog)
    .filter((entry) => entry.kind === "transactional")
    .map((entry) => ({ key: entry.key, title: cardTitle(entry.key) }));

  const deviceRows = db
    .select({
      id: devices.id,
      label: devices.label,
      lastSeenAt: devices.lastSeenAt,
      endpoint: devices.endpoint,
    })
    .from(devices)
    .where(eq(devices.userId, currentUserId))
    .all();

  const hasDevice = deviceRows.length > 0;

  return {
    user: {
      id: currentUser.id,
      name: currentUser.name,
      email: currentUser.email,
      bio: currentUser.bio,
      role: currentUser.role,
    },
    refundRequests,
    notificationCards,
    transactionalEvents,
    devices: deviceRows,
    hasDevice,
    // Null means push is not configured and the turn-on entry points stay hidden.
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();
  if (!currentUser) {
    throw data("User not found.", { status: 404 });
  }

  const formData = await request.formData();

  // One cell of the event×channel matrix: turn it on or off. The profile
  // form posts without an intent and falls through unchanged.
  if (formData.get("intent") === "notification_preference") {
    const parsed = parseFormData(formData, preferenceSchema);

    if (!parsed.success) {
      return data({ errors: parsed.errors }, { status: 400 });
    }

    const { eventKey, channel, state } = parsed.data;
    const { catalog } = await import("~/lib/notifications/catalog");

    if (!(eventKey in catalog)) {
      return data(
        { errors: { eventKey: "Unknown notification event." } },
        { status: 400 }
      );
    }

    try {
      if (state === "on") {
        setPreferenceOn(db, currentUserId, eventKey as EventKey, channel);
      } else {
        setPreferenceOff(db, currentUserId, eventKey as EventKey, channel);
      }
    } catch (error) {
      throw data(
        error instanceof Error ? error.message : "Could not save preference.",
        { status: 400 }
      );
    }

    return { success: true };
  }

  const parsed = parseFormData(formData, settingsSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const { name, bio } = parsed.data;

  db
    .update(users)
    .set({ name, email: currentUser.email, bio: bio || null })
    .where(eq(users.id, currentUser.id))
    .returning()
    .get();
  return { success: true };
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const {
    user,
    refundRequests,
    notificationCards,
    transactionalEvents,
    hasDevice,
    devices: deviceRows,
    vapidPublicKey,
  } = loaderData;
  const openCount = refundRequests.filter(
    (refundRequest) => refundRequest.status === RefundStatus.Open
  ).length;
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [browserEndpoint, setBrowserEndpoint] = useState<string | null>(null);
  const [checkedBrowser, setCheckedBrowser] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const [prePromptOpen, setPrePromptOpen] = useState(false);

  // Which device row (if any) is this browser? A null endpoint still counts
  // as checked — it just means no subscription lives here.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.pushManager.getSubscription())
      .then((subscription) => {
        if (cancelled) return;
        setBrowserEndpoint(subscription?.endpoint ?? null);
        setCheckedBrowser(true);
      })
      .catch(() => {
        if (!cancelled) setCheckedBrowser(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Unsubscribe this browser and delete its Device row, then reload. */
  async function turnOff(endpoint: string) {
    setTurningOff(true);
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription?.endpoint === endpoint) {
          await subscription.unsubscribe();
        }
      }
      const res = await fetch("/devices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      if (!res.ok) {
        toast.error("Could not turn off push on this device. Try again.");
        return;
      }
      navigate(0);
    } finally {
      setTurningOff(false);
    }
  }

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success("Profile updated successfully.");
    }
    if (fetcher.state === "idle" && fetcher.data?.errors) {
      const firstError = Object.values(fetcher.data.errors)[0] as string | undefined;
      if (firstError) toast.error(firstError);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Settings</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Update your profile details
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <h2 className="text-lg font-semibold">Profile</h2>
        </CardHeader>
        <CardContent>
          <fetcher.Form method="post" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                ref={nameInputRef}
                id="name"
                name="name"
                type="text"
                defaultValue={user.name}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={user.email}
                disabled
                className="text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed.
              </p>
            </div>
            {user.role === UserRole.Instructor && (
              <div className="space-y-2">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  name="bio"
                  rows={4}
                  defaultValue={user.bio ?? ""}
                  placeholder="Tell students about yourself..."
                />
                <p className="text-xs text-muted-foreground">
                  Your bio is shown on your course pages.
                </p>
              </div>
            )}
            <Button
              type="submit"
              disabled={fetcher.state !== "idle"}
            >
              {fetcher.state !== "idle" ? "Saving..." : "Save Changes"}
            </Button>
          </fetcher.Form>
        </CardContent>
      </Card>

      <section className="mt-8 max-w-xl space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Notifications</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each notification event, and where you want it. The always-sent
            events sit underneath, out of your way.
          </p>
        </div>

        {notificationCards.map((card) => (
          <PreferenceCard key={card.key} card={card} hasDevice={hasDevice} />
        ))}

        {hasDevice ? (
          <p className="text-xs text-muted-foreground">
            Push is live for your Device — turning an event&apos;s push off
            stops it on every Device.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Push needs a Device: turn notifications on from your phone or
            browser first. Until then the Push toggles do nothing.
          </p>
        )}

        <div className="rounded-xl border border-dashed bg-muted/30 p-4">
          <div className="flex items-center gap-2">
            <Lock className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">
              Always sent — no preferences
            </h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Transactional events land in your notification list and your inbox
            whatever you choose here. They never push.
          </p>
          <ul className="mt-3 space-y-2">
            {transactionalEvents.map((event) => (
              <li
                key={event.key}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span>{event.title}</span>
                <span className="text-xs text-muted-foreground">
                  Email + in-app, always
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-8 max-w-xl space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Your devices</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One Device per browser or phone where you turned push on.
          </p>
        </div>

        {deviceRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No Devices yet. Turn push on and this browser becomes one.
          </p>
        ) : (
          deviceRows.map((device) => (
            <div
              key={device.id}
              className="flex items-center justify-between gap-4 rounded-xl border p-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{device.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Last seen {formatRelativeTime(device.lastSeenAt)}
                </p>
              </div>
              {device.endpoint === browserEndpoint && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={turningOff}
                  onClick={() => turnOff(device.endpoint)}
                >
                  {turningOff ? "Turning off…" : "Turn off"}
                </Button>
              )}
            </div>
          ))
        )}

        {checkedBrowser &&
          !deviceRows.some((device) => device.endpoint === browserEndpoint) &&
          vapidPublicKey && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setPrePromptOpen(true)}
            >
              Turn on push on this device
            </Button>
          )}

        {prePromptOpen && (
          <PushPrePrompt
            role={user.role}
            vapidPublicKey={vapidPublicKey}
            onClose={() => setPrePromptOpen(false)}
            onTurnedOn={() => navigate(0)}
          />
        )}
      </section>

      {refundRequests.length > 0 && (
        <Card className="mt-8 max-w-md">
          <CardHeader>
            <h2 className="text-lg font-semibold">Refund Requests</h2>
            {openCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {openCount === 1
                  ? "One refund request is waiting on us."
                  : `${openCount} refund requests are waiting on us.`}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {refundRequests.map((refundRequest) => (
              <div key={refundRequest.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    to={`/courses/${refundRequest.courseSlug}`}
                    className="font-medium hover:underline"
                  >
                    {refundRequest.courseTitle}
                  </Link>
                  <RefundStatusBadge status={refundRequest.status} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatPrice(refundRequest.amountPaid)} · raised{" "}
                  {new Date(refundRequest.requestedAt).toLocaleDateString()}
                  {refundRequest.resolvedAt && (
                    <>
                      {" "}
                      · decided{" "}
                      {new Date(refundRequest.resolvedAt).toLocaleDateString()}
                    </>
                  )}
                </p>
                <p className="mt-2 text-sm">{refundRequest.reason}</p>
                {refundRequest.decisionNote && (
                  <p className="mt-2 rounded-md bg-muted p-2 text-sm">
                    <span className="font-medium">Our note: </span>
                    {refundRequest.decisionNote}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const CHANNELS: { channel: NotificationChannel; label: string }[] = [
  { channel: NotificationChannel.InApp, label: "In-app" },
  { channel: NotificationChannel.Email, label: "Email" },
  { channel: NotificationChannel.Push, label: "Push" },
];

/** One cell of the event×channel matrix: a labelled on/off switch. */
function PreferenceToggle({
  title,
  eventKey,
  channel,
  label,
  defaultOn,
  disabled,
}: {
  title: string;
  eventKey: string;
  channel: NotificationChannel;
  label: string;
  defaultOn: boolean;
  disabled: boolean;
}) {
  const fetcher = useFetcher();

  // The last submission keeps rendering while it flies, so the switch
  // shows what the user just chose rather than the stale loader value.
  const state = fetcher.formData?.get("state");
  const on = state === "on" ? true : state === "off" ? false : defaultOn;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.errors) {
      const firstError = Object.values(fetcher.data.errors)[0] as
        | string
        | undefined;
      if (firstError) toast.error(firstError);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${title} — ${label}`}
        disabled={disabled}
        onClick={() =>
          fetcher.submit(
            {
              intent: "notification_preference",
              eventKey,
              channel,
              state: on ? "off" : "on",
            },
            { method: "post" }
          )
        }
        className="disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
            on ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            className={`size-4 rounded-full bg-background shadow transition-transform ${
              on ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </span>
      </button>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

/** One Settings card: the event's title and audience, plus its toggles. */
function PreferenceCard({
  card,
  hasDevice,
}: {
  card: Route.ComponentProps["loaderData"]["notificationCards"][number];
  hasDevice: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
      <div>
        <p className="text-sm font-medium">{card.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Addressed to {card.audience} · {card.blurb}
        </p>
      </div>
      <div className="flex items-center gap-4">
        {CHANNELS.map(({ channel, label }) => (
          <PreferenceToggle
            key={channel}
            title={card.title}
            eventKey={card.key}
            channel={channel}
            label={label}
            defaultOn={!card.offChannels.includes(channel)}
            disabled={channel === NotificationChannel.Push && !hasDevice}
          />
        ))}
      </div>
    </div>
  );
}

const REFUND_STATUS_BADGES: Record<
  RefundStatus,
  { label: string; className: string }
> = {
  [RefundStatus.Open]: {
    label: "Open",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  [RefundStatus.Approved]: {
    label: "Approved",
    className:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  [RefundStatus.Declined]: {
    label: "Declined",
    className: "bg-muted text-muted-foreground",
  },
};

function RefundStatusBadge({ status }: { status: RefundStatus }) {
  const badge = REFUND_STATUS_BADGES[status];
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 404) {
      title = "User not found";
      message =
        typeof error.data === "string" ? error.data : "User not found.";
    } else {
      title = `Error ${error.status}`;
      message =
        typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
