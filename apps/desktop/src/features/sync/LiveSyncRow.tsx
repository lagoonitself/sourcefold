import { cn } from "@/lib/utils";
import { useLiveSync } from "./LiveSyncProvider";

// Settings → Account: whether changes from other computers arrive by themselves right now.

const LABELS = {
  live: "On",
  connecting: "Connecting…",
  offline: "No connection",
  off: "Off",
} as const;

const DESCRIPTIONS = {
  live: "Sources, groups, highlights and notes you change on another computer, the website, the extension or Claude show up here within a few seconds, and so do their files in your Sourcefold folder.",
  connecting:
    "Reaching your account. Until then, this computer still checks for changes every 30 seconds and when you switch back to it.",
  offline:
    "This computer is offline. Changes made here and elsewhere meet again when it reconnects; nothing is lost.",
  off: "Sign in to keep this computer in step with your other ones.",
} as const;

export function LiveSyncRow() {
  const { state } = useLiveSync();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13.5px] font-medium text-foreground">
          Sync with your other computers
        </span>
        <p className="text-[12.5px] leading-[18px] text-muted-foreground">{DESCRIPTIONS[state]}</p>
      </div>
      <div className="shrink-0 pt-0.5">
        <span
          role="status"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-medium",
            state === "live"
              ? "text-success"
              : state === "offline"
                ? "text-warning"
                : "text-muted-foreground",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              state === "live"
                ? "bg-success"
                : state === "offline"
                  ? "bg-warning"
                  : "bg-muted-foreground",
              state === "connecting" && "motion-safe:animate-pulse",
            )}
          />
          {LABELS[state]}
        </span>
      </div>
    </div>
  );
}
