import { Bell } from "lucide-react";

// Placeholder: the full bell, badge, and popover arrive with the next commit.
export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  return (
    <button
      type="button"
      title="Notifications"
      aria-label={`Notifications (${unreadCount} unread)`}
      className="rounded-md p-1 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <Bell className="size-4" />
    </button>
  );
}
