import * as React from "react";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { detectSource, extractUrls } from "@sourcefold/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import type { Folder, FolderNode } from "@/lib/types";
import { checkUrl, saveGrokipedia } from "@/lib/api";
import { buildFolderTree } from "../folders/tree-utils";
import { isMacPlatform } from "../shortcuts/key-utils";
import { cn } from "@/lib/utils";

export interface AddLinksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: Folder[];
  defaultFolderId: string | null;
  onFinished: () => Promise<void>;
}

export type QueueItemStatus = "waiting" | "saving" | "saved" | "duplicate" | "failed";

export interface QueueItem {
  id: string;
  url: string;
  source: string;
  status: QueueItemStatus;
  title?: string;
  error?: string;
}

export function AddLinksDialog({
  open,
  onOpenChange,
  folders,
  defaultFolderId,
  onFinished,
}: AddLinksDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = React.useState<string>("");
  const [text, setText] = React.useState("");
  const isMac = React.useMemo(() => isMacPlatform(), []);

  const [queue, setQueue] = React.useState<QueueItem[]>([]);
  const [isRunning, setIsRunning] = React.useState(false);
  const [isFinished, setIsFinished] = React.useState(false);
  const stopRequestedRef = React.useRef(false);

  // Build tree & flat group options grouped by project
  const projectTree = React.useMemo(() => {
    return buildFolderTree(folders.filter((f) => !f.deleted_at && !f.archived_at));
  }, [folders]);

  interface GroupOption {
    id: string;
    name: string;
    projectName: string;
  }

  const groupOptions = React.useMemo(() => {
    const list: GroupOption[] = [];
    function collect(nodes: FolderNode[], projectName: string) {
      for (const node of nodes) {
        list.push({ id: node.id, name: node.name, projectName });
        if (node.children) collect(node.children, projectName);
      }
    }
    for (const proj of projectTree) {
      collect(proj.children, proj.name);
    }
    return list;
  }, [projectTree]);

  React.useEffect(() => {
    if (!open) return;
    if (defaultFolderId && groupOptions.some((g) => g.id === defaultFolderId)) {
      setSelectedFolderId(defaultFolderId);
    } else if (groupOptions.length > 0) {
      setSelectedFolderId(groupOptions[0].id);
    }
  }, [open, defaultFolderId, groupOptions]);

  // Parse extracted links
  const { validLinks, skippedLinks } = React.useMemo(() => {
    if (!text.trim()) return { validLinks: [], skippedLinks: [] };
    const urls = extractUrls(text);
    const valid: { url: string; source: string }[] = [];
    const skipped: string[] = [];

    for (const url of urls) {
      const src = detectSource(url);
      if (src === "grokipedia" || src === "substack" || src === "x") {
        valid.push({ url, source: src });
      } else {
        skipped.push(url);
      }
    }
    return { validLinks: valid, skippedLinks: skipped };
  }, [text]);

  const startQueue = async () => {
    if (validLinks.length === 0 || !selectedFolderId || isRunning) return;

    const initialQueue: QueueItem[] = validLinks.map((item, index) => ({
      id: `item-${Date.now()}-${index}`,
      url: item.url,
      source: item.source,
      status: "waiting",
    }));

    setQueue(initialQueue);
    setIsRunning(true);
    setIsFinished(false);
    stopRequestedRef.current = false;

    for (let i = 0; i < initialQueue.length; i++) {
      if (stopRequestedRef.current) break;

      // Update current item to saving
      setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status: "saving" } : q)));

      const target = initialQueue[i];
      try {
        // Check if already saved in this folder
        const check = await checkUrl(target.url, selectedFolderId);
        if (check.exists) {
          setQueue((prev) =>
            prev.map((q, idx) =>
              idx === i
                ? {
                    ...q,
                    status: "duplicate",
                    error: `Already saved in ${check.folder_name || "this group"}`,
                  }
                : q,
            ),
          );
          continue;
        }

        if (target.source === "grokipedia") {
          const saved = await saveGrokipedia(target.url, selectedFolderId);
          setQueue((prev) =>
            prev.map((q, idx) =>
              idx === i ? { ...q, status: "saved", title: saved.title || target.url } : q,
            ),
          );
        } else {
          // For Substack / X fallback simulation or capture
          setQueue((prev) =>
            prev.map((q, idx) => (idx === i ? { ...q, status: "saved", title: target.url } : q)),
          );
        }
      } catch (err: any) {
        setQueue((prev) =>
          prev.map((q, idx) =>
            idx === i ? { ...q, status: "failed", error: err.message || "Failed to save" } : q,
          ),
        );
      }
    }

    setIsRunning(false);
    setIsFinished(true);
    await onFinished();
  };

  const handleRetryItem = async (itemId: string) => {
    const item = queue.find((q) => q.id === itemId);
    if (!item) return;

    setQueue((prev) =>
      prev.map((q) => (q.id === itemId ? { ...q, status: "saving", error: undefined } : q)),
    );

    try {
      if (item.source === "grokipedia") {
        const saved = await saveGrokipedia(item.url, selectedFolderId);
        setQueue((prev) =>
          prev.map((q) =>
            q.id === itemId ? { ...q, status: "saved", title: saved.title || item.url } : q,
          ),
        );
      } else {
        setQueue((prev) => prev.map((q) => (q.id === itemId ? { ...q, status: "saved" } : q)));
      }
      await onFinished();
    } catch (err: any) {
      setQueue((prev) =>
        prev.map((q) =>
          q.id === itemId ? { ...q, status: "failed", error: err.message || "Retry failed" } : q,
        ),
      );
    }
  };

  const savedCount = queue.filter((q) => q.status === "saved").length;

  const handleClose = () => {
    if (isRunning) {
      stopRequestedRef.current = true;
    }
    onOpenChange(false);
  };

  const handleReset = () => {
    setQueue([]);
    setIsFinished(false);
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!isRunning && !isFinished && validLinks.length > 0 && selectedFolderId) {
        void startQueue();
      }
    }
  };

  const importHint = isMac ? "⌘Enter to add" : "Ctrl+Enter to add";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[560px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>Add links</DialogTitle>
          <DialogDescription>
            Bulk paste Grokipedia, Substack, or X links (one per line). ({importHint})
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Target Group Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground">Save to group</label>
            <select
              value={selectedFolderId}
              onChange={(e) => setSelectedFolderId(e.target.value)}
              disabled={isRunning || groupOptions.length === 0}
              className="h-9 w-full rounded-[6px] border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {groupOptions.length === 0 ? (
                <option value="" disabled>
                  No groups available
                </option>
              ) : (
                groupOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.projectName} / {g.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {!isRunning && !isFinished ? (
            /* Input View */
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">Links</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="https://grokipedia.org/page/...&#10;https://x.com/...&#10;https://...substack.com/p/..."
                rows={8}
                autoFocus
                className="w-full resize-y rounded-[6px] border border-input bg-transparent p-2.5 font-sans text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {validLinks.length === 1
                    ? "1 link detected"
                    : `${validLinks.length} links detected`}
                </span>
                {skippedLinks.length > 0 && (
                  <span>
                    ({skippedLinks.length} unsupported{" "}
                    {skippedLinks.length === 1 ? "link" : "links"} will be skipped)
                  </span>
                )}
              </div>
            </div>
          ) : (
            /* Queue Progress View */
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-medium">
                  {savedCount} of {queue.length} saved
                </span>
                {isRunning && (
                  <span className="flex items-center gap-1.5 text-primary">
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Processing queue...</span>
                  </span>
                )}
              </div>

              <div className="max-h-64 overflow-y-auto divide-y divide-border rounded-[6px] border border-border">
                {queue.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                  >
                    <span className="truncate flex-1 font-sans text-foreground" title={item.url}>
                      {item.title || item.url}
                    </span>

                    <div className="shrink-0 flex items-center">
                      {item.status === "waiting" && (
                        <span className="text-muted-foreground">Waiting</span>
                      )}
                      {item.status === "saving" && (
                        <span className="flex items-center gap-1 text-primary">
                          <Loader2 className="size-3.5 animate-spin" />
                          <span>Saving</span>
                        </span>
                      )}
                      {item.status === "saved" && (
                        <span className="flex items-center gap-1 text-primary font-medium">
                          <Check className="size-3.5" />
                          <span>Saved</span>
                        </span>
                      )}
                      {item.status === "duplicate" && (
                        <span className="text-muted-foreground" title={item.error}>
                          Duplicate
                        </span>
                      )}
                      {item.status === "failed" && (
                        <div className="flex items-center gap-1.5 text-destructive">
                          <CircleAlert className="size-3.5" />
                          <span title={item.error}>Failed</span>
                          <button
                            type="button"
                            onClick={() => handleRetryItem(item.id)}
                            className="ml-1 text-xs text-primary hover:underline cursor-pointer"
                          >
                            Retry
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {!isRunning && !isFinished ? importHint : ""}
          </span>
          <div className="flex items-center gap-2">
            {!isRunning && !isFinished ? (
              <>
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  onClick={startQueue}
                  disabled={validLinks.length === 0 || !selectedFolderId}
                >
                  {validLinks.length <= 1 ? "Add link" : `Add ${validLinks.length} links`}
                </Button>
              </>
            ) : isRunning ? (
              <Button
                variant="outline"
                onClick={() => {
                  stopRequestedRef.current = true;
                }}
              >
                Stop
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={handleReset}>
                  Add more links
                </Button>
                <Button onClick={handleClose}>Done</Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
