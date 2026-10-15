import * as React from "react";
import { FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
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
    <div className="flex flex-col gap-2 rounded-[6px] border border-border p-3 bg-muted/20">
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => void toggle(e.target.checked)}
          className="mt-0.5 cursor-pointer"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-foreground">
            Keep a copy on this computer
          </span>
          <span className="text-[11px] text-muted-foreground">
            Every source is also saved as a file in the storage folder, laid out like your Drive
            folder. Changes on the web or in this app show up within a minute.
          </span>
        </span>
      </label>
      {enabled && (
        <>
          <div className="text-[11px] text-muted-foreground">{summary(state.report, state.at)}</div>
          {failed.length > 0 && (
            <ul className="text-[11px] text-destructive list-disc pl-4">
              {failed.slice(0, 3).map((f) => (
                <li key={f.path || f.message}>
                  {f.path ? `${f.path}: ` : ""}
                  {f.message}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runNow()}
              disabled={syncing}
              className="text-xs h-8 cursor-pointer"
            >
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
              className="text-xs h-8 cursor-pointer"
            >
              <FolderOpen className="size-3.5" />
              Open folder
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
