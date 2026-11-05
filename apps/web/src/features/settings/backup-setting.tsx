"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { callApi, messageOf } from "@/features/sharing/api";
import { Switch } from "@/features/sharing/switch";

interface BackupState {
  enabled: boolean;
  connected: boolean;
}

export function BackupSetting() {
  const [state, setState] = useState<BackupState | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    callApi<BackupState>("/api/settings/backup")
      .then((data) => {
        if (!cancelled) setState(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const change = async (enabled: boolean) => {
    if (!state || saving) return;
    const before = state;
    setState({ ...state, enabled });
    setSaving(true);
    try {
      await callApi("/api/settings/backup", {
        method: "PUT",
        body: { enabled },
        fallback: "Couldn't change the backup. Try again.",
      });
    } catch (err) {
      setState(before);
      toast.error(messageOf(err, "Couldn't change the backup. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <span id="backup-label" className="text-sm font-medium text-foreground">
          Back up to Google Drive
        </span>
        {state ? (
          <Switch
            label="Back up to Google Drive"
            checked={state.enabled}
            onCheckedChange={(on) => void change(on)}
            disabled={saving}
          />
        ) : failed ? null : (
          <div className="h-5 w-9 animate-pulse rounded-full bg-muted" aria-hidden="true" />
        )}
      </div>
      <p className="text-[13px] leading-5 text-muted-foreground">
        Your library always lives in your Sourcefold account. With this on, Sourcefold also copies
        every source into a Sourcefold folder in your Google Drive.
      </p>
      {failed && (
        <p className="text-[13px] text-destructive" role="alert">
          Couldn&apos;t load this setting. Refresh the page to try again.
        </p>
      )}
      {state && !state.connected && (
        <p className="text-[13px] text-foreground">
          Google Drive isn&apos;t connected. Use Reconnect Drive below, then the backup can run.
        </p>
      )}
    </div>
  );
}
