import * as React from "react";
import { AlertCircle, CheckCircle2, Cloud, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { isAnyDialogOpen } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";
import { isRemoteConfigured } from "@/lib/remote-client";
import { fetchDriveStatus, triggerDriveSave } from "./drive-api";
import type { DriveSaveResult, DriveStatus } from "./types";

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

  // Global Ctrl+S keyboard shortcut when unsaved items exist
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        if (isAnyDialogOpen()) return;
        if (status?.connected && (status?.unsaved ?? 0) > 0 && !isSaving) {
          e.preventDefault();
          void handleSave();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, isSaving, status]);

  // Completely hide Drive UI in offline mode or when not signed in
  if (!configured) {
    return null;
  }

  const isSyncing = isSaving || Boolean(status?.is_syncing);

  // If sync is in progress
  if (isSyncing) {
    return (
      <div
        className={cn("inline-flex items-center gap-1.5 px-2 py-1 text-xs select-none", className)}
      >
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground">Saving to Drive...</span>
      </div>
    );
  }

  // If Drive is disconnected or status is not yet available
  if (!status || !status.connected) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-1 text-xs select-none text-muted-foreground",
          className,
        )}
        title={status?.error || "Drive disconnected"}
      >
        <AlertCircle className="size-3.5 text-muted-foreground" />
        <span>Drive disconnected</span>
      </div>
    );
  }

  // When unsaved > 0
  if (status.unsaved > 0) {
    return (
      <div
        className={cn("inline-flex items-center gap-2 px-2 py-1 text-xs select-none", className)}
      >
        <div className="flex items-center gap-1.5">
          <Cloud className="size-3.5 text-amber-500 fill-amber-500/20" />
          <span className="font-medium text-amber-600 dark:text-amber-400">
            {status.unsaved} unsaved
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs text-foreground cursor-pointer"
          onClick={() => void handleSave()}
          disabled={isSyncing}
          title="Ctrl+S"
        >
          Save
        </Button>
      </div>
    );
  }

  // When unsaved === 0: subtle green icon + "Saved to Drive" (shows last saved timestamp on hover)
  const lastSavedTooltip = status.last_saved_at
    ? `Last saved: ${formatLastSaved(status.last_saved_at)}`
    : "All items saved to Drive";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 text-xs select-none text-muted-foreground cursor-default transition-colors hover:text-foreground",
        className,
      )}
      title={lastSavedTooltip}
    >
      <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
      <span>Saved to Drive</span>
    </div>
  );
}
