import * as React from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/Switch";
import { getBackupSetting, setBackupSetting } from "@/lib/api";
import type { BackupSetting as BackupState } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { setBackupEnabledState } from "../drive/backup-store";

/** Settings → General, signed in only: whether the library is also copied to Google Drive. */
export function BackupSetting({ open, signedIn }: { open: boolean; signedIn: boolean }) {
  const [state, setState] = React.useState<BackupState | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open || !signedIn) return;
    let cancelled = false;
    setFailed(false);
    getBackupSetting()
      .then((data) => {
        if (cancelled) return;
        setState(data);
        setBackupEnabledState(data.enabled);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, signedIn]);

  if (!signedIn) return null;

  const change = async (enabled: boolean) => {
    if (!state || saving) return;
    const before = state;
    setState({ ...state, enabled });
    setBackupEnabledState(enabled);
    setSaving(true);
    try {
      await setBackupSetting(enabled);
      window.dispatchEvent(new Event("sourcefold:refresh"));
    } catch (err) {
      setState(before);
      setBackupEnabledState(before.enabled);
      toast.error(errorMessage(err, "Couldn't change the backup. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13.5px] font-medium text-foreground">Back up to Google Drive</span>
          <p className="text-[12.5px] leading-[18px] text-muted-foreground">
            Your library always lives in your Sourcefold account. With this on, Sourcefold also
            copies every source into a Sourcefold folder in your Google Drive.
          </p>
        </div>
        <div className="shrink-0 pt-0.5">
          {state ? (
            <Switch
              checked={state.enabled}
              onCheckedChange={(on) => void change(on)}
              disabled={saving}
              aria-label="Back up to Google Drive"
            />
          ) : failed ? null : (
            <div className="skeleton h-5 w-[34px] rounded-full" aria-hidden="true" />
          )}
        </div>
      </div>
      {failed && (
        <p className="text-[12.5px] text-destructive" role="alert">
          Couldn&apos;t load this setting. Close Settings and open it again to retry.
        </p>
      )}
      {state && state.enabled && !state.connected && (
        <p className="text-[12.5px] text-foreground">
          Google Drive isn&apos;t connected. Sign in again to reconnect it, then the backup can run.
        </p>
      )}
    </div>
  );
}
