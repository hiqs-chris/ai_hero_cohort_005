import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { UserRole } from "~/db/schema";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { turnOnPush, type TurnOnOutcome } from "~/lib/push-client";

// The in-app pre-prompt of ADR-0015: the native permission prompt is never
// called cold — this explains what the role can receive, and its button's
// click is the single gesture that requests permission, subscribes, and
// posts the row.

// Pre-prompt body copy, role-honest, verbatim from the spec's Opt-in
// section. Team Admins hold the Student role, so one entry covers both.
const BODY_BY_ROLE: Record<UserRole, string> = {
  [UserRole.Admin]:
    "When a buyer raises a Refund Request, it reaches your phone. Receipts and decisions stay in your inbox.",
  [UserRole.Instructor]:
    "When someone asks a Question on your courses, it reaches your phone. Receipts and decisions stay in your inbox.",
  [UserRole.Student]:
    "Nothing you receive today can push. When there's activity on your courses, it will reach your phone.",
};

// Uninstalled iPhone Safari: standalone is false there and true once Cadence
// is on the Home Screen; display-mode is the second-line signal. A button in
// the uninstalled browser would silently do nothing, so it is replaced by
// the Add-to-Home-Screen steps.
function isUninstalledIphone(): boolean {
  if (!/iPhone/.test(navigator.userAgent)) return false;
  const standalone = (navigator as Navigator & { standalone?: boolean })
    .standalone;
  const displayStandalone = window.matchMedia(
    "(display-mode: standalone)",
  ).matches;
  return standalone === false || !displayStandalone;
}

function isIphone(): boolean {
  return /iPhone/.test(navigator.userAgent);
}

function isChrome(): boolean {
  return /Chrome\//.test(navigator.userAgent);
}

// Permission denied: no button, just per-browser unblock instructions.
function unblockInstructions() {
  if (isIphone()) {
    return (
      <p>
        Push is blocked for Cadence. Open the Settings app, tap Cadence, then
        Notifications, and allow them.
      </p>
    );
  }
  if (isChrome()) {
    return (
      <p>
        Push is blocked for this site. Open the site settings for cadence.dev
        (the icon left of the address bar), set Notifications to Allow, then
        reload.
      </p>
    );
  }
  return <p>Push is blocked for this site in your browser&apos;s settings.</p>;
}

export function PushPrePrompt({
  role,
  vapidPublicKey,
  onClose,
  onTurnedOn,
}: {
  role: UserRole;
  vapidPublicKey: string | null;
  onClose: () => void;
  onTurnedOn?: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [outcome, setOutcome] = useState<TurnOnOutcome | null>(null);

  // Focus lands on the dialog when it opens.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Esc closes; so does the backdrop. The card stops the click.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // The single user gesture iOS demands: nothing is awaited between the
  // click and turnOnPush's permission request.
  async function handleTurnOn() {
    const result = await turnOnPush(vapidPublicKey);
    if (result === "granted") {
      onClose();
      onTurnedOn?.();
      return;
    }
    setOutcome(result);
  }

  // Push not configured server-side: the prompt stays hidden.
  if (!vapidPublicKey) return null;

  const denied =
    (typeof Notification !== "undefined" &&
      Notification.permission === "denied") ||
    outcome === "denied";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <Card
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="push-pre-prompt-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md outline-none"
      >
        <CardHeader>
          <h2 id="push-pre-prompt-title" className="text-lg font-semibold">
            Turn on push notifications
          </h2>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>{BODY_BY_ROLE[role]}</p>

          {isUninstalledIphone() ? (
            <div className="space-y-2">
              <p>
                Push on the iPhone needs Cadence on your Home Screen first:
              </p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  In Safari, tap the Share button and add Cadence to the Home
                  Screen.
                </li>
                <li>Open Cadence from the Home Screen.</li>
                <li>Turn on push from there.</li>
              </ol>
            </div>
          ) : denied ? (
            unblockInstructions()
          ) : (
            <div className="space-y-3">
              {outcome === "unsupported" && (
                <p>This browser can&apos;t receive push notifications.</p>
              )}
              {outcome === "dismissed" && <p>You can turn push on anytime.</p>}
              <Button type="button" onClick={handleTurnOn}>
                Turn on push notifications
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>,
    document.body,
  );
}
