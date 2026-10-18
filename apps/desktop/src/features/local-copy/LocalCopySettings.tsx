import * as React from "react";
import { CircleAlert, FolderCheck, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  getLastLocalCopy,
  getLocalCopyEnabled,
  onLocalCopyChange,
  openStorageFolder,
  setLocalCopyEnabled,
  syncLocalCopy,
  type LocalCopyReport,
} from "./local-copy";

function summary(report: LocalCopyReport | null, at: Date | null): string {
  if (!report || !at) return "Not copied yet.";
  if (report.status === "off") return "Off.";
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const files = `${report.total} ${report.total === 1 ? "file" : "files"}`;
  if (report.failed.length > 0) {
    return `${files}, ${report.failed.length} couldn't be copied (${time}).`;
  }
  return `Up to date: ${files} (${time}).`;
}

function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <label
      className={cn(
        "relative inline-flex h-5 w-[34px] shrink-0 cursor-pointer items-center select-none",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        type="checkbox"
        id={id}
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="h-5 w-[34px] rounded-full bg-border-strong transition-colors duration-150 ease-out peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
      />
      <span
        aria-hidden="true"
        className="absolute left-0.5 top-0.5 size-4 rounded-full bg-background shadow-xs transition-transform duration-150 ease-spring peer-checked:translate-x-3.5"
      />
    </label>
  );
}

/** Settings → General, signed in only: the copy of the library on this computer. */
export function LocalCopySettings({ open, signedIn }: { open: boolean; signedIn: boolean }) {
  const [enabled, setEnabled] = React.useState(true);
  const [state, setState] = React.useState(getLastLocalCopy);
  const [syncing, setSyncing] = React.useState(false);

  React.useEffect(() => onLocalCopyChange(() => setState(getLastLocalCopy())), []);
  React.useEffect(() => {
    if (!open) return;
    getLocalCopyEnabled()
      .then(setEnabled)
      .catch(() => {});
  }, [open]);

  if (!signedIn) return null;

  const runNow = async () => {
    setSyncing(true);
    try {
      const report = await syncLocalCopy();
      const problem = report?.failed[0];
      if (problem)
        toast.error(problem.path ? `${problem.path}: ${problem.message}` : problem.message);
    } catch (err: any) {
      toast.error(err?.message || "Couldn't copy the files.");
    } finally {
      setSyncing(false);
    }
  };

  const toggle = async (next: boolean) => {
    setEnabled(next);
    try {
      await setLocalCopyEnabled(next);
      if (next) void runNow();
    } catch (err: any) {
      setEnabled(!next);
      toast.error(err?.message || "Couldn't change the setting.");
    }
  };

  const failed = state.report?.failed ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-[13.5px] font-medium text-foreground">
            Keep a copy on this computer
          </span>
          <p className="text-[12.5px] leading-[18px] text-muted-foreground">
            Every source is also saved as a file in the storage folder, laid out like your Drive
            folder. Changes on the web or in this app show up within a minute.
          </p>
        </div>
        <div className="shrink-0 pt-0.5">
          <Switch
            checked={enabled}
            onCheckedChange={(val) => void toggle(val)}
            aria-label="Keep a copy on this computer"
          />
        </div>
      </div>

      {enabled && (
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <FolderCheck className="size-3.5 shrink-0 text-muted-foreground" />
            <span>{summary(state.report, state.at)}</span>
          </div>

          {failed.length > 0 && (
            <div className="flex flex-col gap-1 rounded-[8px] bg-destructive/10 p-2.5 text-[12px] text-destructive">
              <div className="flex items-center gap-1.5 font-medium">
                <CircleAlert className="size-3.5 shrink-0" />
                <span>Files that couldn&apos;t be copied</span>
              </div>
              <ul className="list-disc pl-5 space-y-0.5">
                {failed.slice(0, 3).map((f) => (
                  <li key={f.path || f.message}>
                    {f.path ? `${f.path}: ` : ""}
                    {f.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2 pt-0.5">
            <Button variant="outline" size="sm" onClick={() => void runNow()} disabled={syncing}>
              {syncing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Copy now
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openStorageFolder().catch((e) => toast.error(String(e)))}
            >
              <FolderOpen className="size-3.5" />
              Open folder
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
