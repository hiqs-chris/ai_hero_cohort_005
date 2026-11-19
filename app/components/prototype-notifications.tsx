// PROTOTYPE — throwaway, never merged (wayfinder #10).
//
// Question: what should the in-app notification surfaces look like?
// Plan: "Three variants of the in-app notification surfaces — sidebar bell +
// list, Settings notifications section — switchable via `?variant=` on the
// existing `/settings` route; the sidebar picks the variant up on any page."
//
// Semantics are already settled and shared by every variant (ADR-0015,
// ADR-0016, ADR-0017): badge = unread count; bell for every signed-in user;
// one row per event, newest first; read rows stay and dim; no delete, no
// archive; click-through = navigate + mark read, opening the panel marks
// nothing; "Mark all read" exists; every event lands in-app, transactional
// events are locked in the matrix; the push column is inert until a Device
// exists; the empty state doubles as the push opt-in entry point.
//
// The variants disagree only about STRUCTURE: entry placement, panel
// mechanics, row anatomy, and matrix layout.
//
// Deliberately rough: fake data, in-memory state only, no tests, no error
// handling. Delete this file (and revert the two call-site edits in
// sidebar.tsx and settings.tsx) once the prototype has served its purpose.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  BadgeCheck,
  Bell,
  BellOff,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Lock,
  MessageSquare,
  Receipt,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { UserRole } from "~/db/schema";

// ---------------------------------------------------------------------------
// Fake data — the notification catalog (ADR-0017) and demo rows
// ---------------------------------------------------------------------------

type EventKind = "notification" | "transactional";

interface CatalogEvent {
  key: string;
  title: string;
  audience: string;
  blurb: string;
  kind: EventKind;
}

const CATALOG: Record<string, CatalogEvent> = {
  "refund_request.raised": {
    key: "refund_request.raised",
    title: "Refund Request raised",
    audience: "every Platform Admin",
    blurb: "A buyer raised a Refund Request on a course.",
    kind: "notification",
  },
  "question.asked": {
    key: "question.asked",
    title: "Question asked on your course",
    audience: "the course's Instructor",
    blurb: "Someone asked a Question on a lesson in one of your courses.",
    kind: "notification",
  },
  "refund_request.received": {
    key: "refund_request.received",
    title: "Refund Request received",
    audience: "the buyer",
    blurb: "Confirmation that we got your Refund Request, and what happens next.",
    kind: "transactional",
  },
  "refund_request.decided": {
    key: "refund_request.decided",
    title: "Refund Request decided",
    audience: "the buyer",
    blurb: "A Platform Admin approved or declined your Refund Request.",
    kind: "transactional",
  },
};

/** The matrix shows only the events addressed to audiences this user belongs to. */
function matrixEventsFor(role: UserRole): CatalogEvent[] {
  const events: CatalogEvent[] = [];
  if (role === UserRole.Admin) events.push(CATALOG["refund_request.raised"]);
  if (role === UserRole.Instructor) events.push(CATALOG["question.asked"]);
  events.push(CATALOG["refund_request.received"], CATALOG["refund_request.decided"]);
  return events;
}

interface DemoNotification {
  id: number;
  eventKey: string;
  icon: "receipt" | "question" | "inbox" | "check";
  line1: string;
  line2: string;
  minutesAgo: number;
  read: boolean;
  href: string;
}

function seedFor(role: UserRole): DemoNotification[] {
  if (role === UserRole.Admin) {
    return [
      { id: 1, eventKey: "refund_request.raised", icon: "receipt", line1: "Refund Request raised", line2: "Advanced Mixing Fundamentals · £89.00 · Priya K.", minutesAgo: 10, read: false, href: "/admin/refunds" },
      { id: 2, eventKey: "refund_request.raised", icon: "receipt", line1: "Refund Request raised", line2: "Guitar Basics · £49.00 · Tom S.", minutesAgo: 130, read: false, href: "/admin/refunds" },
      { id: 3, eventKey: "refund_request.raised", icon: "receipt", line1: "Refund Request raised", line2: "Music Theory I · £39.00 · Ana R.", minutesAgo: 4320, read: true, href: "/admin/refunds" },
      { id: 4, eventKey: "refund_request.received", icon: "inbox", line1: "Refund Request received", line2: "Guitar Basics · we'll email you when it's decided", minutesAgo: 7200, read: true, href: "/settings" },
    ];
  }
  if (role === UserRole.Instructor) {
    return [
      { id: 1, eventKey: "question.asked", icon: "question", line1: "Question asked", line2: "Advanced Mixing Fundamentals · EQ Basics · Sam T.", minutesAgo: 25, read: false, href: "/instructor/questions" },
      { id: 2, eventKey: "question.asked", icon: "question", line1: "Question asked", line2: "Advanced Mixing Fundamentals · Reverb tails · Jo M.", minutesAgo: 180, read: false, href: "/instructor/questions" },
      { id: 3, eventKey: "question.asked", icon: "question", line1: "Question asked", line2: "Guitar Basics · Chord shapes · Lee P.", minutesAgo: 1560, read: true, href: "/instructor/questions" },
      { id: 4, eventKey: "refund_request.received", icon: "inbox", line1: "Refund Request received", line2: "Music Theory I · we'll email you when it's decided", minutesAgo: 5760, read: true, href: "/settings" },
    ];
  }
  return [
    { id: 1, eventKey: "refund_request.received", icon: "inbox", line1: "Refund Request received", line2: "Advanced Mixing Fundamentals · we'll email you when it's decided", minutesAgo: 65, read: false, href: "/settings" },
    { id: 2, eventKey: "refund_request.decided", icon: "check", line1: "Refund Request decided", line2: "Music Theory I · approved — your refund is on its way", minutesAgo: 2880, read: true, href: "/settings" },
    { id: 3, eventKey: "refund_request.received", icon: "inbox", line1: "Refund Request received", line2: "Guitar Basics · we'll email you when it's decided", minutesAgo: 8640, read: true, href: "/settings" },
  ];
}

/** In-memory demo state — nothing persists, on purpose. */
function useDemoNotifications(role: UserRole) {
  const [rows, setRows] = useState<DemoNotification[]>(() => seedFor(role));
  const unreadCount = rows.filter((r) => !r.read).length;
  return {
    rows,
    unreadCount,
    isEmpty: rows.length === 0,
    markRead: (id: number) =>
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, read: true } : r))),
    markAllRead: () => setRows((rs) => rs.map((r) => ({ ...r, read: true }))),
    clear: () => setRows([]),
    restore: () => setRows(seedFor(role)),
  };
}

function relTime(minutesAgo: number): string {
  if (minutesAgo < 60) return `${minutesAgo}m`;
  const h = Math.floor(minutesAgo / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

// ---------------------------------------------------------------------------
// Tiny atoms — shared data affordances, never shared layout
// ---------------------------------------------------------------------------

function RowIcon({ icon, className }: { icon: DemoNotification["icon"]; className?: string }) {
  const Cmp = icon === "receipt" ? Receipt : icon === "question" ? MessageSquare : icon === "inbox" ? Inbox : BadgeCheck;
  return <Cmp className={className} />;
}

function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function CheapSwitch({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-input",
        disabled && "cursor-not-allowed opacity-40"
      )}
    >
      <span
        className={cn(
          "inline-block size-4 transform rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

/** The empty state is one of the two push opt-in entry points (ADR-0015). */
function BellEmpty() {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <BellOff className="size-6 text-muted-foreground/60" />
      <p className="text-sm font-medium">You're all caught up</p>
      <p className="max-w-64 text-xs text-muted-foreground">
        Refund Requests and Questions can reach your phone. Push carries
        notification events only — receipts and decisions stay in your inbox.
      </p>
      <Button
        size="xs"
        variant="outline"
        onClick={() =>
          toast.info(
            "Prototype stub — the in-app pre-prompt would open here, never the cold native prompt (ADR-0015)."
          )
        }
      >
        Turn on push notifications
      </Button>
    </div>
  );
}

function DemoDataChrome({ isEmpty, onClear, onRestore }: { isEmpty: boolean; onClear: () => void; onRestore: () => void }) {
  return (
    <button
      type="button"
      onClick={isEmpty ? onRestore : onClear}
      className="text-[10px] text-muted-foreground/60 hover:underline"
    >
      prototype: {isEmpty ? "restore demo data" : "clear demo data (see empty state)"}
    </button>
  );
}

/** Prototype chrome: simulate "this browser has turned on push" (a Device exists). */
function DeviceSim({ hasDevice, onChange }: { hasDevice: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        checked={hasDevice}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-foreground"
      />
      prototype: pretend this browser has turned on push (a Device exists)
    </label>
  );
}

// ---------------------------------------------------------------------------
// Variant A — "Sidebar-native": nav-style entry, list lives INSIDE the
// sidebar column; Settings is a classic matrix table.
// ---------------------------------------------------------------------------

export function PrototypeBellA({ role }: { role: UserRole }) {
  const { rows, unreadCount, isEmpty, markRead, markAllRead, clear, restore } =
    useDemoNotifications(role);
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <span className="flex items-center gap-3">
          <Bell className="size-4" />
          Notifications
        </span>
        <CountBadge count={unreadCount} />
      </button>
      {open && (
        <div className="mb-2 overflow-hidden rounded-md border bg-background text-foreground shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs text-muted-foreground">
              {unreadCount === 0 ? "All read" : `${unreadCount} unread`}
            </span>
            <button
              type="button"
              onClick={markAllRead}
              className="text-xs font-medium text-primary hover:underline"
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {isEmpty ? (
              <BellEmpty />
            ) : (
              rows.map((row) => (
                <Link
                  key={row.id}
                  to={row.href}
                  onClick={() => markRead(row.id)}
                  className={cn(
                    "flex items-start gap-2 border-b px-3 py-2 last:border-0 hover:bg-accent",
                    !row.read && "bg-primary/5"
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0 rounded-full",
                      row.read ? "bg-transparent" : "bg-primary"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-sm",
                        row.read ? "text-muted-foreground" : "font-medium"
                      )}
                    >
                      {row.line1}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.line2}
                    </span>
                    <span className="block text-[10px] text-muted-foreground/70">
                      {relTime(row.minutesAgo)} ago
                    </span>
                  </span>
                </Link>
              ))
            )}
          </div>
          <div className="flex items-center justify-between border-t px-3 py-1.5">
            <Link
              to="/settings"
              className="text-[11px] text-muted-foreground hover:underline"
            >
              Manage preferences
            </Link>
            <DemoDataChrome isEmpty={isEmpty} onClear={clear} onRestore={restore} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant B — "Popover": compact icon entry in the user row, wide floating
// panel over the content; Settings is a stacked per-event list with the
// always-sent events boxed away underneath.
// ---------------------------------------------------------------------------

export function PrototypeBellB({ role }: { role: UserRole }) {
  const { rows, unreadCount, isEmpty, markRead, markAllRead, clear, restore } =
    useDemoNotifications(role);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        className="relative rounded-md p-1 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute bottom-0 left-full z-50 ml-2 flex max-h-[70vh] w-96 flex-col overflow-hidden rounded-xl border bg-background text-foreground shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-sm font-semibold">
              Notifications
              {unreadCount > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {unreadCount} unread
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={markAllRead}
              className="text-xs font-medium text-primary hover:underline"
            >
              Mark all read
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isEmpty ? (
              <BellEmpty />
            ) : (
              rows.map((row) => (
                <Link
                  key={row.id}
                  to={row.href}
                  onClick={() => markRead(row.id)}
                  className={cn(
                    "flex items-start gap-3 border-b px-4 py-3 last:border-0 hover:bg-accent",
                    !row.read && "bg-primary/5"
                  )}
                >
                  <RowIcon
                    icon={row.icon}
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-sm",
                          row.read ? "text-muted-foreground" : "font-medium"
                        )}
                      >
                        {row.line1}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/70">
                        {relTime(row.minutesAgo)}
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {row.line2}
                    </div>
                  </div>
                  {!row.read && (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                  )}
                </Link>
              ))
            )}
          </div>
          <div className="flex items-center justify-between border-t px-4 py-1.5">
            <Link
              to="/settings"
              className="text-[11px] text-muted-foreground hover:underline"
            >
              Manage preferences
            </Link>
            <DemoDataChrome isEmpty={isEmpty} onClear={clear} onRestore={restore} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant C — "Drawer": bell in the Cadence header, slide-over drawer with
// day-grouped rows; Settings groups the matrix by the part you play.
// ---------------------------------------------------------------------------

export function PrototypeBellC({ role }: { role: UserRole }) {
  const { rows, unreadCount, isEmpty, markRead, markAllRead, clear, restore } =
    useDemoNotifications(role);
  const [open, setOpen] = useState(false);

  const groups = [
    { label: "Today", rows: rows.filter((r) => r.minutesAgo < 1440) },
    {
      label: "Yesterday",
      rows: rows.filter((r) => r.minutesAgo >= 1440 && r.minutesAgo < 2880),
    },
    { label: "Earlier", rows: rows.filter((r) => r.minutesAgo >= 2880) },
  ].filter((g) => g.rows.length > 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Notifications"
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        <CountBadge count={unreadCount} className="absolute -right-1 -top-1 min-w-4 px-1 leading-4" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-0 flex h-full w-[420px] flex-col bg-background text-foreground shadow-2xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-base font-semibold">
                Notifications
                {unreadCount > 0 && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {unreadCount} unread
                  </span>
                )}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Mark all read
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {isEmpty ? (
                <BellEmpty />
              ) : (
                groups.map((group) => (
                  <div key={group.label}>
                    <div className="bg-muted/50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {group.label}
                    </div>
                    {group.rows.map((row) => (
                      <Link
                        key={row.id}
                        to={row.href}
                        onClick={() => markRead(row.id)}
                        className={cn(
                          "flex items-start gap-3 border-b px-4 py-3 last:border-0 hover:bg-accent",
                          !row.read && "bg-primary/5"
                        )}
                      >
                        <RowIcon
                          icon={row.icon}
                          className={cn(
                            "mt-0.5 size-4 shrink-0",
                            row.read ? "text-muted-foreground/50" : "text-foreground"
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              "text-sm",
                              row.read ? "text-muted-foreground" : "font-medium"
                            )}
                          >
                            {row.line1}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {row.line2}
                          </div>
                        </div>
                        <span className="mt-0.5 shrink-0 text-[10px] text-muted-foreground/70">
                          {relTime(row.minutesAgo)}
                        </span>
                      </Link>
                    ))}
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-between border-t px-4 py-2">
              <Link
                to="/settings"
                className="text-[11px] text-muted-foreground hover:underline"
              >
                Manage preferences
              </Link>
              <DemoDataChrome isEmpty={isEmpty} onClear={clear} onRestore={restore} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Settings — the notifications section, three structures
// ---------------------------------------------------------------------------

const CHANNELS = ["in-app", "email", "push"] as const;
type Channel = (typeof CHANNELS)[number];
const CHANNEL_LABELS: Record<Channel, string> = {
  "in-app": "In-app",
  email: "Email",
  push: "Push",
};

function useDemoPrefs() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const get = (key: string, ch: Channel) => prefs[`${key}:${ch}`] ?? true;
  const set = (key: string, ch: Channel, v: boolean) =>
    setPrefs((p) => ({ ...p, [`${key}:${ch}`]: v }));
  return { get, set };
}

function SettingsA({ role }: { role: UserRole }) {
  const events = matrixEventsFor(role);
  const { get, set } = useDemoPrefs();
  const [hasDevice, setHasDevice] = useState(false);
  const notif = events.filter((e) => e.kind === "notification");
  const trans = events.filter((e) => e.kind === "transactional");

  return (
    <section className="mt-8 max-w-2xl">
      <h2 className="text-lg font-semibold">Notifications</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick a channel per event. Transactional events are always sent — no
        preferences to manage.
      </p>
      <div className="mt-4 overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5">Event</th>
              {CHANNELS.map((ch) => (
                <th key={ch} className="w-24 px-3 py-2.5 text-center">
                  {CHANNEL_LABELS[ch]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {notif.map((ev) => (
              <tr key={ev.key} className="border-b last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium">{ev.title}</div>
                  <div className="text-xs text-muted-foreground">
                    Addressed to {ev.audience}
                  </div>
                </td>
                {CHANNELS.map((ch) => (
                  <td key={ch} className="px-3 py-3 text-center">
                    <CheapSwitch
                      label={`${ev.title} — ${CHANNEL_LABELS[ch]}`}
                      checked={get(ev.key, ch)}
                      disabled={ch === "push" && !hasDevice}
                      onCheckedChange={(v) => set(ev.key, ch, v)}
                    />
                  </td>
                ))}
              </tr>
            ))}
            {trans.map((ev) => (
              <tr key={ev.key} className="border-b bg-muted/20 last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Lock className="size-3.5 text-muted-foreground" />
                    {ev.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Addressed to {ev.audience} · always sent
                  </div>
                </td>
                <td className="px-3 py-3 text-center text-xs text-muted-foreground">Always on</td>
                <td className="px-3 py-3 text-center text-xs text-muted-foreground">Always on</td>
                <td className="px-3 py-3 text-center text-xs text-muted-foreground">Never</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {hasDevice
          ? "Push is live for your Device — turning an event's push off stops it on every Device."
          : "Push needs a Device: turn notifications on from your phone or browser first (Your devices). Until then the Push column does nothing."}
      </p>
      <DeviceSim hasDevice={hasDevice} onChange={setHasDevice} />
    </section>
  );
}

function SettingsB({ role }: { role: UserRole }) {
  const events = matrixEventsFor(role);
  const { get, set } = useDemoPrefs();
  const [hasDevice, setHasDevice] = useState(false);
  const notif = events.filter((e) => e.kind === "notification");
  const trans = events.filter((e) => e.kind === "transactional");

  return (
    <section className="mt-8 max-w-xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each notification event, and where you want it. The always-sent
          events sit underneath, out of your way.
        </p>
      </div>
      {notif.map((ev) => (
        <div
          key={ev.key}
          className="flex items-center justify-between gap-4 rounded-xl border p-4"
        >
          <div className="min-w-0">
            <div className="font-medium">{ev.title}</div>
            <div className="text-xs text-muted-foreground">
              Addressed to {ev.audience} · {ev.blurb}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-5">
            {CHANNELS.map((ch) => (
              <div key={ch} className="flex flex-col items-center gap-1">
                <CheapSwitch
                  label={`${ev.title} — ${CHANNEL_LABELS[ch]}`}
                  checked={get(ev.key, ch)}
                  disabled={ch === "push" && !hasDevice}
                  onCheckedChange={(v) => set(ev.key, ch, v)}
                />
                <span className="text-[11px] text-muted-foreground">
                  {CHANNEL_LABELS[ch]}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="rounded-xl border border-dashed bg-muted/30 p-4">
        <div className="flex items-center gap-2 font-medium">
          <Lock className="size-4 text-muted-foreground" />
          Always sent — no preferences
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Transactional events land in your notification list and your inbox
          whatever you choose here. They never push.
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          {trans.map((ev) => (
            <li key={ev.key} className="flex items-baseline justify-between gap-3">
              <span>{ev.title}</span>
              <span className="text-xs text-muted-foreground">
                Email + in-app, always
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">
        {hasDevice
          ? "Push is live for your Device — turning an event's push off stops it on every Device."
          : "Push needs a Device: turn notifications on from your phone or browser first (Your devices). Until then the Push toggles do nothing."}
      </p>
      <DeviceSim hasDevice={hasDevice} onChange={setHasDevice} />
    </section>
  );
}

function SettingsC({ role }: { role: UserRole }) {
  const { get, set } = useDemoPrefs();
  const [hasDevice, setHasDevice] = useState(false);

  const groups: {
    id: string;
    heading: string;
    explainer: string;
    locked: boolean;
    events: CatalogEvent[];
  }[] = [];
  if (role === UserRole.Admin) {
    groups.push({
      id: "admin",
      heading: "As a Platform Admin",
      explainer: "What you're told about the platform you run.",
      locked: false,
      events: [CATALOG["refund_request.raised"]],
    });
  }
  if (role === UserRole.Instructor) {
    groups.push({
      id: "instructor",
      heading: "As an Instructor",
      explainer: "What you're told about your courses.",
      locked: false,
      events: [CATALOG["question.asked"]],
    });
  }
  groups.push({
    id: "buyer",
    heading: "As a buyer",
    explainer: "The paper trail for your own Purchases and Refund Requests.",
    locked: true,
    events: [CATALOG["refund_request.received"], CATALOG["refund_request.decided"]],
  });

  return (
    <section className="mt-8 max-w-2xl space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Grouped by the part you play — run the platform, teach, buy.
        </p>
      </div>
      {groups.map((group) => (
        <div key={group.id}>
          <h3 className="flex items-center gap-2 font-semibold">
            {group.heading}
            {group.locked && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Lock className="size-3" /> always sent
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{group.explainer}</p>
          <div className="mt-2 divide-y rounded-xl border">
            {group.events.map((ev) => (
              <div key={ev.key} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="font-medium">{ev.title}</div>
                  <div className="text-xs text-muted-foreground">
                    Addressed to {ev.audience} · {ev.blurb}
                  </div>
                </div>
                {group.locked ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Email + in-app, always · never push
                  </span>
                ) : (
                  <div className="flex shrink-0 items-center gap-5">
                    {CHANNELS.map((ch) => (
                      <div key={ch} className="flex flex-col items-center gap-1">
                        <CheapSwitch
                          label={`${ev.title} — ${CHANNEL_LABELS[ch]}`}
                          checked={get(ev.key, ch)}
                          disabled={ch === "push" && !hasDevice}
                          onCheckedChange={(v) => set(ev.key, ch, v)}
                        />
                        <span className="text-[11px] text-muted-foreground">
                          {CHANNEL_LABELS[ch]}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        {hasDevice
          ? "Push is live for your Device — turning an event's push off stops it on every Device."
          : "Push needs a Device: turn notifications on from your phone or browser first (Your devices). Until then the Push toggles do nothing."}
      </p>
      <DeviceSim hasDevice={hasDevice} onChange={setHasDevice} />
    </section>
  );
}

export function PrototypeNotificationsSettings({
  variant,
  role,
}: {
  variant: string;
  role: UserRole;
}) {
  if (variant === "B") return <SettingsB role={role} />;
  if (variant === "C") return <SettingsC role={role} />;
  return <SettingsA role={role} />;
}

// ---------------------------------------------------------------------------
// The floating variant switcher — prototype chrome, never part of the design
// ---------------------------------------------------------------------------

const VARIANT_ORDER = ["A", "B", "C"] as const;
const VARIANT_NAMES: Record<string, string> = {
  A: "Sidebar-native",
  B: "Popover",
  C: "Drawer",
};

export function PrototypeSwitcher() {
  const [searchParams, setSearchParams] = useSearchParams();
  const current = searchParams.get("variant");

  function cycle(dir: 1 | -1) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const idx = current
          ? VARIANT_ORDER.indexOf(current as (typeof VARIANT_ORDER)[number])
          : -1;
        const nextKey =
          VARIANT_ORDER[(idx + dir + VARIANT_ORDER.length) % VARIANT_ORDER.length];
        next.set("variant", nextKey);
        return next;
      },
      { replace: true }
    );
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowLeft") cycle(-1);
      else if (e.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD || !current) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 shadow-2xl ring-1 ring-white/10">
      <button
        type="button"
        onClick={() => cycle(-1)}
        title="Previous variant (←)"
        className="rounded-full p-1.5 hover:bg-white/10"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-44 text-center font-medium">
        {current} · {VARIANT_NAMES[current] ?? "?"}
      </span>
      <button
        type="button"
        onClick={() => cycle(1)}
        title="Next variant (→)"
        className="rounded-full p-1.5 hover:bg-white/10"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
