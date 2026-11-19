import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useNavigate } from "react-router";
import { Bell, Inbox, Receipt, type LucideIcon } from "lucide-react";
import { cn, formatRelativeTime } from "~/lib/utils";
import { UserRole } from "~/db/schema";
import { Button } from "~/components/ui/button";
import { PushPrePrompt } from "~/components/push-pre-prompt";

type NotificationItem = {
  id: number;
  eventKey: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
};

// The /notifications resource's answer shape, shared by GET (the list) and
// POST (mark one or all read).
type NotificationsPayload = {
  notifications: NotificationItem[];
  unreadCount: number;
};

const EVENT_ICONS: Record<string, LucideIcon> = {
  "refund_request.raised": Receipt,
  "refund_request.received": Inbox,
  "refund_request.decided": Inbox,
};

export function NotificationBell({
  unreadCount,
  role,
  vapidPublicKey,
}: {
  unreadCount: number;
  role: UserRole;
  vapidPublicKey: string | null;
}) {
  const fetcher = useFetcher<NotificationsPayload>();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [prePromptOpen, setPrePromptOpen] = useState(false);
  const [count, setCount] = useState(unreadCount);
  const rootRef = useRef<HTMLDivElement>(null);

  // GET and POST answer with the same shape, so one effect feeds the badge
  // from whichever spoke last: the fetcher's answer once it has one, else
  // the layout loader's count.
  const fetcherUnread = fetcher.data?.unreadCount;
  useEffect(() => {
    setCount(fetcherUnread ?? unreadCount);
  }, [fetcherUnread, unreadCount]);

  // Close on outside pointerdown and on Escape. The root spans the button
  // and the panel, so a press inside either keeps the popover open.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        rootRef.current?.contains(event.target)
      ) {
        return;
      }
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function handleBellClick() {
    const next = !open;
    setOpen(next);
    if (next) fetcher.load("/notifications");
  }

  function markRead(payload: { id: number } | { all: true }) {
    fetcher.submit(JSON.stringify(payload), {
      method: "post",
      action: "/notifications",
      encType: "application/json",
    });
  }

  // One action: read the notification, follow its link, close the popover.
  function handleRowClick(notification: NotificationItem) {
    if (notification.readAt === null) markRead({ id: notification.id });
    setOpen(false);
    navigate(notification.link);
  }

  const rows = fetcher.data?.notifications ?? [];
  const loading = fetcher.state !== "idle" && !fetcher.data;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title="Notifications"
        aria-label={`Notifications (${count} unread)`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={handleBellClick}
        className="relative rounded-md p-1 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        {count > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute bottom-0 left-full z-50 ml-2 w-96 rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {count} unread
              </span>
              <button
                type="button"
                onClick={() => markRead({ all: true })}
                disabled={count === 0}
                className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
              >
                Mark all read
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Loading…
              </p>
            ) : rows.length === 0 ? (
              <div className="space-y-3 px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Refund Requests and Questions can reach your phone. Push
                  carries notification events only — receipts and decisions
                  stay in your inbox.
                </p>
                {vapidPublicKey && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPrePromptOpen(true)}
                  >
                    Turn on push notifications
                  </Button>
                )}
              </div>
            ) : (
              rows.map((notification) => {
                const Icon = EVENT_ICONS[notification.eventKey] ?? Bell;
                const unread = notification.readAt === null;
                return (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => handleRowClick(notification)}
                    className={cn(
                      "flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-accent last:border-b-0",
                      unread ? "bg-primary/5" : "text-muted-foreground"
                    )}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {notification.title}
                      </span>
                      <span className="block truncate text-xs">
                        {notification.body}
                      </span>
                      <span
                        className="mt-0.5 block text-xs"
                        suppressHydrationWarning
                      >
                        {formatRelativeTime(notification.createdAt)}
                      </span>
                    </span>
                    {unread && (
                      <span
                        aria-hidden
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                      />
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t px-4 py-2">
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              Manage preferences
            </Link>
          </div>
        </div>
      )}

      {prePromptOpen && (
        <PushPrePrompt
          role={role}
          vapidPublicKey={vapidPublicKey}
          onClose={() => setPrePromptOpen(false)}
          onTurnedOn={() => setPrePromptOpen(false)}
        />
      )}
    </div>
  );
}
