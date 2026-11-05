import * as React from "react";
import { toast } from "sonner";
import { describeQueuedLink, type LinkWorkersSeen } from "@sourcefold/core";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import type { Folder } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { deleteLinkQueueRow, patchLinkQueue } from "./api";
import {
  groupPath,
  linkTitle,
  panelNextStep,
  rowActions,
  sortRecent,
  type RowAction,
} from "./panel";
import type { LinkQueueRow } from "./types";

export interface LinksPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: LinkQueueRow[];
  seen: LinkWorkersSeen | null;
  folders: Folder[];
  onOpenItem: (itemId: string) => void;
  /** Called after Retry, Dismiss or Cancel so the list reloads. */
  onChanged: () => Promise<void> | void;
}

const ACTION_LABELS: Record<RowAction, string> = {
  open: "Open",
  retry: "Retry",
  dismiss: "Dismiss",
  cancel: "Cancel",
};

/** "Links from Claude": the last 7 days of queued links, newest first. */
export function LinksPanel({
  open,
  onOpenChange,
  rows,
  seen,
  folders,
  onOpenItem,
  onChanged,
}: LinksPanelProps) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const now = Date.now();
  const sorted = React.useMemo(() => sortRecent(rows), [rows]);
  const nextStep = panelNextStep(rows, seen, now);

  const run = async (row: LinkQueueRow, action: RowAction) => {
    if (action === "open") {
      if (row.item_id) onOpenItem(row.item_id);
      return;
    }
    setBusy(row.id);
    try {
      if (action === "retry") {
        await patchLinkQueue(row.id, { status: "waiting", needs: row.needs });
      } else {
        await deleteLinkQueueRow(row.id);
      }
      await onChanged();
    } catch (error) {
      toast.error(errorMessage(error, "That didn't work. Try again."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Links from Claude</DialogTitle>
          {nextStep && (
            <p className="text-[13px] leading-[19px] text-foreground">{nextStep}</p>
          )}
        </DialogHeader>
        {sorted.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No links from the last 7 days.
          </p>
        ) : (
          <ul className="-mx-1 flex max-h-[60vh] flex-col overflow-y-auto">
            {sorted.map((row) => {
              const info = describeQueuedLink(row, seen, now);
              const path = groupPath(folders, row.folder_id);
              const actions = rowActions(row, info);
              return (
                <li
                  key={row.id}
                  className="flex items-start gap-3 rounded-[9px] px-2 py-2.5 hover:bg-muted/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-foreground">
                      {linkTitle(row)}
                    </div>
                    <div className="truncate text-[12px] text-muted-foreground">
                      {[path, row.added_by ? `added by ${row.added_by}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-foreground">
                      {info.label}
                      {info.hint && (
                        <span className="text-muted-foreground"> {info.hint}</span>
                      )}
                    </div>
                  </div>
                  {actions.length > 0 && (
                    <div className="flex shrink-0 items-center gap-1">
                      {actions.map((action) => (
                        <Button
                          key={action}
                          variant="ghost"
                          size="sm"
                          disabled={busy === row.id}
                          onClick={() => void run(row, action)}
                        >
                          {ACTION_LABELS[action]}
                        </Button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
