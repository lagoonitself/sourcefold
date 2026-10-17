import * as React from "react";
import { Check, CircleAlert, Loader2, Lock } from "lucide-react";
import {
  classifySubstackLink,
  detectLinkKind,
  detectSource,
  extractUrls,
  isWikipediaArticleUrl,
  parseYouTubeLink,
} from "@sourcefold/core";
import { isYouTubeRateLimit } from "@sourcefold/core/capture";
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
import { findPublicationPosts, saveSubstackPost } from "../substack/substack-client";
import { saveWikipediaArticle } from "../wikipedia/wikipedia-client";
import { findYouTubeVideos, saveSourceLink } from "../sources/source-client";
import {
  YOUTUBE_RATE_LIMIT_WAITS_MS,
  formatWait,
  isYouTubeVideoLink,
  waitUnlessStopped,
  youTubeGapMs,
} from "../sources/youtube-pacing";
import { buildFolderTree } from "../folders/tree-utils";
import { isMacPlatform } from "../shortcuts/key-utils";

export interface AddLinksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: Folder[];
  defaultFolderId: string | null;
  /** Starts the paste box with this text when the dialog opens (e.g. links to save). */
  initialText?: string;
  onFinished: () => Promise<void>;
}

// `source` is any of the 2026-10 kinds (YouTube video, web page, Reddit, Hacker News, Bluesky,
// PDF); `youtube_list` is a playlist or channel, replaced by one row per video.
type LinkSource =
  "grokipedia" | "wikipedia" | "substack" | "publication" | "source" | "youtube_list";

export type QueueItemStatus =
  | "waiting"
  | "finding"
  | "saving"
  // waiting out a YouTube rate limit before trying the same video again
  | "paused"
  | "saved"
  | "duplicate"
  | "paid"
  | "unavailable"
  | "failed";

export interface QueueItem {
  id: string;
  url: string;
  source: LinkSource;
  status: QueueItemStatus;
  title?: string;
  message?: string;
}

interface ParsedLinks {
  valid: { url: string; source: LinkSource }[];
  xLinks: string[];
  skipped: string[];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseLinks(text: string): ParsedLinks {
  const parsed: ParsedLinks = { valid: [], xLinks: [], skipped: [] };
  if (!text.trim()) return parsed;
  const seen = new Set<string>();
  for (const url of extractUrls(text)) {
    if (seen.has(url)) continue;
    seen.add(url);
    const source = detectSource(url);
    const substack = classifySubstackLink(url);
    if (source === "grokipedia") parsed.valid.push({ url, source: "grokipedia" });
    else if (isWikipediaArticleUrl(url)) parsed.valid.push({ url, source: "wikipedia" });
    else if (source === "x") parsed.xLinks.push(url);
    else if (substack === "post") parsed.valid.push({ url, source: "substack" });
    else if (substack === "publication") parsed.valid.push({ url, source: "publication" });
    else if (detectLinkKind(url) === "youtube" && parseYouTubeLink(url)?.type !== "video") {
      parsed.valid.push({ url, source: "youtube_list" });
    } else if (detectLinkKind(url)) parsed.valid.push({ url, source: "source" });
    else parsed.skipped.push(url);
  }
  return parsed;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

let nextId = 0;
function newId(): string {
  nextId += 1;
  return `link-${Date.now()}-${nextId}`;
}

export function AddLinksDialog({
  open,
  onOpenChange,
  folders,
  defaultFolderId,
  initialText,
  onFinished,
}: AddLinksDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = React.useState<string>("");
  const [text, setText] = React.useState("");
  const [after, setAfter] = React.useState("");
  const [before, setBefore] = React.useState("");
  const isMac = React.useMemo(() => isMacPlatform(), []);

  const [queue, setQueue] = React.useState<QueueItem[]>([]);
  const [isRunning, setIsRunning] = React.useState(false);
  const [isFinished, setIsFinished] = React.useState(false);
  const queueRef = React.useRef<QueueItem[]>([]);
  const stopRequestedRef = React.useRef(false);
  const abortRef = React.useRef<AbortController | null>(null);

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

  React.useEffect(() => {
    if (open && initialText) setText(initialText);
  }, [open, initialText]);

  const links = React.useMemo(() => parseLinks(text), [text]);
  const hasPublication = links.valid.some((l) => l.source === "publication");
  const dateError =
    (after && !DATE_PATTERN.test(after)) || (before && !DATE_PATTERN.test(before))
      ? "Use dates like 2026-01-31."
      : after && before && after >= before
        ? "The start date must be before the end date."
        : null;

  const setItems = (items: QueueItem[]) => {
    queueRef.current = items;
    setQueue(items);
  };

  const patchItem = (id: string, patch: Partial<QueueItem>) => {
    setItems(queueRef.current.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  const saveOne = async (item: QueueItem, folderId: string) => {
    if (item.source === "grokipedia") {
      const check = await checkUrl(item.url, folderId);
      if (check.exists) {
        patchItem(item.id, {
          status: "duplicate",
          message: `Already saved in ${check.folder_name || "this group"}`,
        });
        return;
      }
      const saved = await saveGrokipedia(item.url, folderId);
      patchItem(item.id, { status: "saved", title: saved.title || item.url, message: undefined });
      return;
    }

    if (item.source === "wikipedia") {
      const outcome = await saveWikipediaArticle(item.url, folderId);
      if (outcome.kind === "saved") {
        patchItem(item.id, { status: "saved", title: outcome.title, message: undefined });
      } else {
        patchItem(item.id, {
          status: "duplicate",
          title: outcome.title ?? item.title,
          message: outcome.message,
        });
      }
      return;
    }

    if (item.source === "source") {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const outcome = await saveSourceLink(item.url, folderId, controller.signal);
        if (outcome.kind === "saved") {
          patchItem(item.id, { status: "saved", title: outcome.title, message: undefined });
        } else if (outcome.kind === "unavailable") {
          patchItem(item.id, {
            status: "unavailable",
            title: outcome.title,
            message: outcome.reason,
          });
        } else {
          patchItem(item.id, {
            status: "duplicate",
            title: outcome.title ?? item.title,
            message: outcome.message,
          });
        }
      } finally {
        abortRef.current = null;
      }
      return;
    }

    const outcome = await saveSubstackPost(item.url, folderId);
    if (outcome.kind === "saved") {
      patchItem(item.id, {
        status: "saved",
        title: outcome.title,
        message: outcome.paid ? "Paid post" : undefined,
      });
    } else if (outcome.kind === "paid_locked") {
      patchItem(item.id, { status: "paid", title: outcome.title, message: outcome.reason });
    } else {
      patchItem(item.id, {
        status: "duplicate",
        title: outcome.title ?? item.title,
        message: outcome.message,
      });
    }
  };

  // Replaces a publication row with one row per post, in place.
  const expandPublication = async (item: QueueItem) => {
    patchItem(item.id, { status: "finding", message: "Finding posts…" });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const posts = await findPublicationPosts(item.url, {
        after: after || null,
        before: before || null,
        signal: controller.signal,
        onProgress: (found) => patchItem(item.id, { message: `Finding posts… ${found} so far` }),
      });
      if (posts.length === 0) {
        patchItem(item.id, {
          status: "failed",
          message: after || before ? "No posts in that date range." : "No posts found.",
        });
        return;
      }
      const rows: QueueItem[] = posts.map((p) => ({
        id: newId(),
        url: p.url,
        source: "substack",
        status: "waiting",
        title: p.title ?? undefined,
        message: p.access === "paid" ? "Paid post" : undefined,
      }));
      const index = queueRef.current.findIndex((q) => q.id === item.id);
      const next = [...queueRef.current];
      next.splice(index, 1, ...rows);
      setItems(next);
    } catch (err) {
      if (controller.signal.aborted) {
        patchItem(item.id, { status: "waiting", message: undefined });
      } else {
        patchItem(item.id, {
          status: "failed",
          message: errorMessage(err, "Couldn't list posts."),
        });
      }
    } finally {
      abortRef.current = null;
    }
  };

  // Replaces a YouTube playlist or channel row with one row per video, in place.
  const expandYouTubeList = async (item: QueueItem) => {
    patchItem(item.id, { status: "finding", message: "Finding videos…" });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const list = await findYouTubeVideos(item.url, { signal: controller.signal });
      if (list.videos.length === 0) {
        patchItem(item.id, { status: "failed", message: "No videos found." });
        return;
      }
      const rows: QueueItem[] = list.videos.map((video) => ({
        id: newId(),
        url: video.url,
        source: "source",
        status: "waiting",
        title: video.title,
        message: video.duration ?? undefined,
      }));
      if (list.truncated) {
        rows[0] = {
          ...rows[0],
          message: `Only the first ${list.videos.length} videos are added.`,
        };
      }
      const index = queueRef.current.findIndex((q) => q.id === item.id);
      const next = [...queueRef.current];
      next.splice(index, 1, ...rows);
      setItems(next);
    } catch (err) {
      if (controller.signal.aborted) {
        patchItem(item.id, { status: "waiting", message: undefined });
      } else {
        patchItem(item.id, {
          status: "failed",
          message: errorMessage(err, "Couldn't list the videos."),
        });
      }
    } finally {
      abortRef.current = null;
    }
  };

  const isYouTubeRow = (item: QueueItem) =>
    item.source === "source" && isYouTubeVideoLink(item.url);

  // On a YouTube rate limit, waits and tries the same video again (see youtube-pacing.ts).
  const saveWithYouTubeRetries = async (item: QueueItem, folderId: string) => {
    for (let attempt = 0; ; attempt++) {
      try {
        await saveOne(item, folderId);
        return;
      } catch (err) {
        const wait = YOUTUBE_RATE_LIMIT_WAITS_MS[attempt];
        if (!isYouTubeRateLimit(err) || wait === undefined || stopRequestedRef.current) throw err;
        const waited = await waitUnlessStopped(
          wait,
          () => stopRequestedRef.current,
          (seconds) =>
            patchItem(item.id, {
              status: "paused",
              message: `YouTube is limiting requests. Trying again in ${formatWait(seconds)}.`,
            }),
        );
        if (!waited) throw err;
        patchItem(item.id, { status: "saving", message: undefined });
      }
    }
  };

  const runQueue = async (folderId: string) => {
    setIsRunning(true);
    setIsFinished(false);
    stopRequestedRef.current = false;
    let lastWasYouTube = false;
    // Set when YouTube kept refusing after the waits: the other videos stay Waiting for a Retry.
    let youTubeLimited = false;

    while (!stopRequestedRef.current) {
      const item = queueRef.current.find(
        (q) => q.status === "waiting" && !(youTubeLimited && isYouTubeRow(q)),
      );
      if (!item) break;

      if (item.source === "publication") {
        await expandPublication(item);
        lastWasYouTube = false;
        continue;
      }
      if (item.source === "youtube_list") {
        await expandYouTubeList(item);
        lastWasYouTube = true;
        continue;
      }

      const youTube = isYouTubeRow(item);
      if (youTube && lastWasYouTube) {
        const waited = await waitUnlessStopped(youTubeGapMs(), () => stopRequestedRef.current);
        if (!waited) break;
      }
      lastWasYouTube = youTube;

      patchItem(item.id, { status: "saving" });
      try {
        await saveWithYouTubeRetries(item, folderId);
      } catch (err) {
        if (stopRequestedRef.current) {
          patchItem(item.id, { status: "waiting", message: undefined });
        } else if (youTube && isYouTubeRateLimit(err)) {
          youTubeLimited = true;
          patchItem(item.id, {
            status: "failed",
            message:
              "YouTube is still limiting requests, so the other videos are left waiting. Press Retry in a few minutes.",
          });
        } else {
          patchItem(item.id, { status: "failed", message: errorMessage(err, "Failed to save") });
        }
      }
    }

    setIsRunning(false);
    setIsFinished(true);
    await onFinished();
  };

  const startQueue = async () => {
    if (links.valid.length === 0 || !selectedFolderId || isRunning || dateError) return;
    setItems(
      links.valid.map((link) => ({
        id: newId(),
        url: link.url,
        source: link.source,
        status: "waiting",
      })),
    );
    await runQueue(selectedFolderId);
  };

  const handleRetryItem = async (itemId: string) => {
    if (isRunning) return;
    patchItem(itemId, { status: "waiting", message: undefined });
    await runQueue(selectedFolderId);
  };

  const handleStop = () => {
    stopRequestedRef.current = true;
    abortRef.current?.abort();
  };

  const savedCount = queue.filter((q) => q.status === "saved").length;
  const postCount = queue.filter(
    (q) => q.source !== "publication" && q.source !== "youtube_list",
  ).length;

  const handleClose = () => {
    if (isRunning) handleStop();
    onOpenChange(false);
  };

  const handleReset = () => {
    setItems([]);
    setIsFinished(false);
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!isRunning && !isFinished && links.valid.length > 0 && selectedFolderId) {
        void startQueue();
      }
    }
  };

  const importHint = isMac ? "⌘Enter to add" : "Ctrl+Enter to add";
  const ignoredCount = links.skipped.length + links.xLinks.length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[600px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>Add links</DialogTitle>
          <DialogDescription>
            Paste links, one per line: YouTube videos (saves the transcript), web pages, PDFs and
            arXiv papers, Reddit, Hacker News and Bluesky threads, Grokipedia, Wikipedia and
            Substack. A YouTube playlist or channel, or a Substack publication, saves every video or
            post in it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
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
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">Links</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  "https://www.youtube.com/watch?v=...\nhttps://www.youtube.com/playlist?list=...\nhttps://example.com/article\nhttps://grokipedia.com/page/...\nhttps://name.substack.com"
                }
                rows={8}
                autoFocus
                className="w-full resize-y rounded-[6px] border border-input bg-transparent p-2.5 font-sans text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {links.valid.length === 1
                    ? "1 link detected"
                    : `${links.valid.length} links detected`}
                </span>
                {ignoredCount > 0 && (
                  <span>
                    {ignoredCount} {ignoredCount === 1 ? "link" : "links"} will be skipped
                  </span>
                )}
              </div>
              {links.xLinks.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  X posts are saved from the Chrome extension: open the post and click Save.
                </p>
              )}

              {hasPublication && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-foreground">
                    Publication posts (optional date range)
                  </label>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Published after</span>
                    <input
                      type="date"
                      value={after}
                      onChange={(e) => setAfter(e.target.value)}
                      className="h-8 rounded-[6px] border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <span>and before</span>
                    <input
                      type="date"
                      value={before}
                      onChange={(e) => setBefore(e.target.value)}
                      className="h-8 rounded-[6px] border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  {dateError ? (
                    <p className="text-xs text-destructive">{dateError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Leave empty to save every post. Paid posts need your Substack cookie in
                      Settings.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-medium">
                  {savedCount} of {postCount} saved
                </span>
                {isRunning && (
                  <span className="flex items-center gap-1.5 text-primary">
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Saving…</span>
                  </span>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto divide-y divide-border rounded-[6px] border border-border">
                {queue.map((item) => (
                  <div key={item.id} className="flex flex-col gap-0.5 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate flex-1 font-sans text-foreground" title={item.url}>
                        {item.title || item.url}
                      </span>
                      <div className="shrink-0 flex items-center">
                        {item.status === "waiting" && (
                          <span className="text-muted-foreground">Waiting</span>
                        )}
                        {item.status === "paused" && (
                          <span className="text-muted-foreground">Paused</span>
                        )}
                        {(item.status === "saving" || item.status === "finding") && (
                          <span className="flex items-center gap-1 text-primary">
                            <Loader2 className="size-3.5 animate-spin" />
                            <span>
                              {item.status !== "finding"
                                ? "Saving"
                                : item.source === "youtube_list"
                                  ? "Finding videos"
                                  : "Finding posts"}
                            </span>
                          </span>
                        )}
                        {item.status === "saved" && (
                          <span className="flex items-center gap-1 text-primary font-medium">
                            <Check className="size-3.5" />
                            <span>Saved</span>
                          </span>
                        )}
                        {item.status === "duplicate" && (
                          <span className="text-muted-foreground">Already saved</span>
                        )}
                        {item.status === "paid" && (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Lock className="size-3.5" />
                            <span>Paid, not saved</span>
                          </span>
                        )}
                        {item.status === "unavailable" && (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <CircleAlert className="size-3.5" />
                            <span>Not saved</span>
                          </span>
                        )}
                        {item.status === "failed" && (
                          <div className="flex items-center gap-1.5 text-destructive">
                            <CircleAlert className="size-3.5" />
                            <span>Failed</span>
                            {!isRunning && (
                              <button
                                type="button"
                                onClick={() => handleRetryItem(item.id)}
                                className="ml-1 text-xs text-primary hover:underline cursor-pointer"
                              >
                                Retry
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {item.message && item.status !== "waiting" && item.status !== "saving" && (
                      <span
                        className={
                          item.status === "failed" ? "text-destructive" : "text-muted-foreground"
                        }
                      >
                        {item.message}
                      </span>
                    )}
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
                  disabled={links.valid.length === 0 || !selectedFolderId || Boolean(dateError)}
                >
                  {links.valid.length <= 1 ? "Add link" : `Add ${links.valid.length} links`}
                </Button>
              </>
            ) : isRunning ? (
              <Button variant="outline" onClick={handleStop}>
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
