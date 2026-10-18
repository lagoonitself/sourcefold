import * as React from "react";
import { AlertCircle, CloudUpload, HardDrive, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isMacPlatform } from "../shortcuts/key-utils";
import { isRemoteConfigured } from "@/lib/remote-client";
import { fetchDriveStatus, triggerDriveSave } from "./drive-api";
import type { DriveSaveResult, DriveStatus } from "./types";

/** Dispatch on `window` to save to Drive through the status button (shows its progress and toasts). */
export const SAVE_TO_DRIVE_EVENT = "sourcefold:save-to-drive";

export interface DriveSyncStatusProps {
  className?: string;
  onSaved?: (result: DriveSaveResult) => void;
}

function formatLastSaved(isoString: string | null): string {
  if (!isoString) return "Never";
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

export function DriveSyncStatus({ className, onSaved }: DriveSyncStatusProps) {
  const [configured, setConfigured] = React.useState(isRemoteConfigured());
  const [status, setStatus] = React.useState<DriveStatus | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  const loadStatus = React.useCallback(async () => {
    if (!isRemoteConfigured()) {
      setStatus(null);
      return null;
    }
    try {
      const data = await fetchDriveStatus();
      setStatus(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  React.useEffect(() => {
    const onAuthChanged = () => {
      const isConfig = isRemoteConfigured();
      setConfigured(isConfig);
      if (isConfig) {
        void loadStatus();
      } else {
        setStatus(null);
      }
    };

    window.addEventListener("sourcefold:auth-changed", onAuthChanged);
    window.addEventListener("sourcefold:refresh", loadStatus);

    if (configured) {
      void loadStatus();
    }

    const interval = setInterval(() => {
      if (isRemoteConfigured()) {
        void loadStatus();
      }
    }, 30000);

    const onFocus = () => {
      if (isRemoteConfigured()) {
        void loadStatus();
      }
    };
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("sourcefold:auth-changed", onAuthChanged);
      window.removeEventListener("sourcefold:refresh", loadStatus);
    };
  }, [configured, loadStatus]);

  const handleSave = React.useCallback(async () => {
    if (isSaving || !configured) return;
    setIsSaving(true);
    try {
      const result = await triggerDriveSave();
      if (result.failed && result.failed.length > 0) {
        if (result.processed > 0) {
          toast.warning(
            `Saved ${result.processed} items to Drive (${result.failed.length} failed)`,
          );
        } else {
          toast.error(`Drive save failed: ${result.failed[0]?.message || "Failed to save items"}`);
        }
      } else {
        const count = result.processed;
        toast.success(
          count > 0 ? `Saved ${count} item${count === 1 ? "" : "s"} to Drive` : "Saved to Drive",
        );
      }
      onSaved?.(result);
      await loadStatus();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save to Drive");
    } finally {
      setIsSaving(false);
    }
  }, [configured, isSaving, loadStatus, onSaved]);

  // Mod+S and the command palette ask for a save through this event (see App.tsx).
  React.useEffect(() => {
    const onSaveRequest = () => void handleSave();
    window.addEventListener(SAVE_TO_DRIVE_EVENT, onSaveRequest);
    return () => window.removeEventListener(SAVE_TO_DRIVE_EVENT, onSaveRequest);
  }, [handleSave]);

  const pill =
    "inline-flex h-8 shrink-0 select-none items-center gap-2 rounded-[9px] px-2.5 text-[13px] font-medium transition-colors duration-150";

  // Offline mode: everything is already on this computer.
  if (!configured) {
    return (
      <div
        className={cn(pill, "cursor-default text-muted-foreground", className)}
        title="Offline library. Sources are saved in Documents/Sourcefold on this computer."
      >
        <HardDrive className="size-4" aria-hidden="true" />
        <span className="hidden @[720px]/topbar:inline">On this computer</span>
      </div>
    );
  }

  const isSyncing = isSaving || Boolean(status?.is_syncing);

  if (isSyncing) {
    return (
      <div className={cn(pill, "text-muted-foreground", className)} role="status">
        <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        <span className="hidden @[720px]/topbar:inline">Saving to Drive</span>
      </div>
    );
  }

  if (!status || !status.connected) {
    return (
      <div
        className={cn(pill, "cursor-default text-warning", className)}
        title={status?.error || "Google Drive isn't connected. Reconnect it in Settings."}
      >
        <AlertCircle className="size-4" aria-hidden="true" />
        <span className="hidden @[720px]/topbar:inline">Drive disconnected</span>
      </div>
    );
  }

  if (status.unsaved > 0) {
    return (
      <button
        type="button"
        onClick={() => void handleSave()}
        title={`Save to Drive (${isMacPlatform() ? "⌘S" : "Ctrl+S"})`}
        className={cn(
          pill,
          "cursor-pointer text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)] hover:bg-muted motion-safe:active:scale-[0.97]",
          className,
        )}
      >
        <CloudUpload className="size-4" aria-hidden="true" />
        <span className="hidden @[720px]/topbar:inline">Save to Drive</span>
        <span
          className="min-w-5 rounded-[6px] bg-marker-strong px-1.5 text-center text-[11.5px] font-semibold leading-5 text-marker-strong-foreground tabular-nums"
          aria-label={`${status.unsaved} unsaved`}
        >
          {status.unsaved}
        </span>
      </button>
    );
  }

  const lastSavedTooltip = status.last_saved_at
    ? `Saved to Drive ${formatLastSaved(status.last_saved_at)}`
    : "Everything is saved to Drive";

  return (
    <div
      className={cn(pill, "cursor-default text-muted-foreground hover:text-foreground", className)}
      title={lastSavedTooltip}
    >
      <span className="relative flex size-2" aria-hidden="true">
        <span className="absolute inset-0 rounded-full bg-success opacity-40 motion-safe:animate-ping [animation-iteration-count:2]" />
        <span className="relative size-2 rounded-full bg-success" />
      </span>
      <span className="hidden @[720px]/topbar:inline">Saved to Drive</span>
    </div>
  );
}
