"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { detectSource, extractUrls } from "@sourcefold/core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildFolderTree, type FolderInputRow, type FolderNode } from "@/features/folders/tree";
import { useLinkQueue, type QueueItem } from "./use-link-queue";
import { cn } from "@/lib/utils";

export type FlattenedFolderOption = {
  id: string;
  name: string;
  depth: number;
  label: string;
};

export function flattenFolderOptions(nodes: FolderNode[], depth = 0): FlattenedFolderOption[] {
  const result: FlattenedFolderOption[] = [];
  for (const node of nodes) {
    const prefix = depth > 0 ? "— ".repeat(depth) : "";
    result.push({
      id: node.id,
      name: node.name,
      depth,
      label: `${prefix}${node.name}`,
    });
    if (node.children && node.children.length > 0) {
      result.push(...flattenFolderOptions(node.children, depth + 1));
    }
  }
  return result;
}

export interface AddLinksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddLinksDialog({ open, onOpenChange }: AddLinksDialogProps) {
  const searchParams = useSearchParams();
  const [folderOptions, setFolderOptions] = useState<FlattenedFolderOption[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [text, setText] = useState("");

  const {
    items,
    status,
    isRunning,
    isStopping,
    sessionExpired,
    savedCount,
    totalCount,
    start,
    stop,
    retry,
    reset,
  } = useLinkQueue();

  useEffect(() => {
    if (!open) return;

    let ignore = false;
    queueMicrotask(() => {
      if (!ignore) {
        setFoldersLoading(true);
        setFoldersError(null);
      }
    });

    async function fetchFolders() {
      try {
        const res = await fetch("/api/folders");
        if (ignore) return;
        if (!res.ok) {
          throw new Error("Failed to load folders");
        }
        const json = await res.json();
        if (ignore) return;
        const rows: FolderInputRow[] = json.data ?? [];
        const tree = buildFolderTree(rows);
        const options = flattenFolderOptions(tree);
        setFolderOptions(options);

        setSelectedFolderId((current) => {
          if (current && options.some((opt) => opt.id === current)) {
            return current;
          }
          const folderParam = searchParams.get("folder");
          if (folderParam && options.some((opt) => opt.id === folderParam)) {
            return folderParam;
          }
          return options[0]?.id ?? "";
        });
      } catch (err: unknown) {
        if (ignore) return;
        setFoldersError(err instanceof Error ? err.message : "Failed to load folders");
      } finally {
        if (!ignore) {
          setFoldersLoading(false);
        }
      }
    }

    void fetchFolders();

    return () => {
      ignore = true;
    };
  }, [open, searchParams]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (isRunning) {
        stop();
      }
    } else {
      if (status === "finished" || status === "stopped") {
        reset();
        setText("");
      }
    }
    onOpenChange(nextOpen);
  };

  const { grokipediaLinks, skippedLinks } = useMemo(() => {
    if (!text.trim()) {
      return { grokipediaLinks: [], skippedLinks: [] };
    }
    const extracted = extractUrls(text);
    const grokipediaLinks: string[] = [];
    const skippedLinks: string[] = [];

    for (const url of extracted) {
      if (detectSource(url) === "grokipedia") {
        grokipediaLinks.push(url);
      } else {
        skippedLinks.push(url);
      }
    }
    return { grokipediaLinks, skippedLinks };
  }, [text]);

  const n = grokipediaLinks.length;
  const m = skippedLinks.length;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (n === 0 || !selectedFolderId || isRunning || foldersLoading) return;
    start(grokipediaLinks, selectedFolderId);
  };

  const handleAddMore = () => {
    reset();
    setText("");
  };

  const isFormView = status === "idle";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-sans text-lg font-semibold leading-6">
            Add Grokipedia links
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Paste links, one per line. Each article is saved as Markdown in the folder you choose.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Folder Select */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="folder-select" className="text-xs font-medium text-foreground">
              Save to
            </label>
            <select
              id="folder-select"
              value={selectedFolderId}
              onChange={(e) => setSelectedFolderId(e.target.value)}
              disabled={isRunning || foldersLoading || folderOptions.length === 0}
              className="h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground"
            >
              {foldersLoading ? (
                <option value="" disabled>
                  Loading folders...
                </option>
              ) : folderOptions.length === 0 ? (
                <option value="" disabled>
                  Create a folder first.
                </option>
              ) : (
                folderOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))
              )}
            </select>
            {!foldersLoading && folderOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">Create a folder first.</p>
            )}
            {foldersError && <p className="text-xs text-destructive">{foldersError}</p>}
          </div>

          {/* Form View (Textarea + Summary) */}
          {isFormView ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="links-textarea" className="text-xs font-medium text-foreground">
                Links
              </label>
              <textarea
                id="links-textarea"
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="https://grokipedia.com/page/..."
                className="w-full min-w-0 resize-y rounded-md border border-input bg-transparent p-2.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30"
                disabled={isRunning}
              />
              <div className="text-xs text-muted-foreground">
                <span>{n === 1 ? "1 Grokipedia link found" : `${n} Grokipedia links found`}</span>
                {m > 0 && (
                  <span>
                    {", "}
                    {m === 1 ? "1 other link will be skipped" : `${m} other links will be skipped`}
                  </span>
                )}
              </div>
            </div>
          ) : (
            /* Results View (While running or after finishing) */
            <div className="flex flex-col gap-2">
              {sessionExpired && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  Your session ended. Sign in again.
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {savedCount} of {totalCount} saved
                </span>
              </div>

              <div
                className="max-h-[320px] overflow-y-auto divide-y divide-border rounded-md border border-border bg-background"
                role="list"
                aria-label="Link queue results"
              >
                {items.map((item) => (
                  <ResultRow key={item.id} item={item} onRetry={retry} />
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {isFormView ? (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                onClick={handleSubmit}
                disabled={
                  n === 0 ||
                  !selectedFolderId ||
                  isRunning ||
                  foldersLoading ||
                  folderOptions.length === 0
                }
              >
                {n === 1 ? "Add 1 link" : `Add ${n} links`}
              </Button>
            </>
          ) : isRunning ? (
            <Button variant="outline" onClick={stop} disabled={isStopping}>
              {isStopping ? "Stopping..." : "Stop"}
            </Button>
          ) : (
            <>
              {!sessionExpired && (
                <Button variant="outline" onClick={handleAddMore}>
                  Add more links
                </Button>
              )}
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResultRow({ item, onRetry }: { item: QueueItem; onRetry: (id: string) => void }) {
  const isSaved = item.status === "saved";
  const displayText = isSaved && item.title ? item.title : item.url;

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm" role="listitem">
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate",
            isSaved && item.title
              ? "font-serif text-[15px] font-medium text-foreground"
              : "font-sans text-xs text-muted-foreground",
          )}
          title={displayText}
        >
          {displayText}
        </p>
      </div>
      <div className="shrink-0 flex items-center">{renderRowStatus(item, onRetry)}</div>
    </div>
  );
}

function renderRowStatus(item: QueueItem, onRetry: (id: string) => void) {
  switch (item.status) {
    case "waiting":
      return <span className="text-xs text-muted-foreground">Waiting</span>;

    case "saving":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
          <span>Saving</span>
        </span>
      );

    case "saved":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
          <Check className="size-3.5" aria-hidden="true" />
          <span>Saved</span>
        </span>
      );

    case "duplicate":
      return (
        <span
          className="max-w-[220px] truncate text-xs text-muted-foreground"
          title={item.message ?? "Already saved."}
        >
          {item.message ?? "Already saved."}
        </span>
      );

    case "failed": {
      const displayMsg = item.message
        ? item.message.toLowerCase().includes("failed")
          ? item.message
          : `Failed: ${item.message}`
        : "Failed";

      return (
        <div className="inline-flex items-center gap-1.5 text-xs text-destructive">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="max-w-[180px] truncate" title={displayMsg}>
            {displayMsg}
          </span>
          <button
            type="button"
            onClick={() => onRetry(item.id)}
            className="ml-1 text-xs font-medium text-primary hover:underline underline-offset-2 cursor-pointer"
          >
            Retry
          </button>
        </div>
      );
    }
  }
}
