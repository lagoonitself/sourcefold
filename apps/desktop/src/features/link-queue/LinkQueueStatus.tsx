import * as React from "react";
import { AppWindow, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { LinkWorkersSeen } from "@sourcefold/core";
import { useAuth } from "@/features/auth";
import { getAppVersion } from "@/features/updates/update-store";
import { isRemoteConfigured, isSessionExpiredError } from "@/lib/remote-client";
import type { Folder } from "@/lib/types";
import { cn } from "@/lib/utils";
import { checkInDesktop, getLinkWorkers, listRecentLinks } from "./api";
import { formatBatchToast, formatSavingDetail, formatSavingStatus } from "./copy";
import { createDesktopDrainHooks } from "./desktop-hooks";
import { drainDesktopQueue } from "./drain";
import { LinksPanel } from "./LinksPanel";
import {
  CHECK_IN_MS,
  REFRESH_OPEN_MS,
  detectChromeSaved,
  formatChromeSavedToast,
  formatPillSummary,
  hasWorkToShow,
  isOpenRow,
  readLastLooked,
  statusMap,
  writeLastLooked,
} from "./panel";
import { createLinkQueueRunner } from "./runner";
import type { BatchSummary, DrainProgress, LinkQueueRow } from "./types";
import { desktopWorkerId } from "./worker-id";

const pill =
  "inline-flex h-8 shrink-0 select-none items-center gap-2 rounded-[9px] px-2.5 text-[13px] font-medium text-muted-foreground";

function showToast(summary: BatchSummary, text: string) {
  if (
    summary.saved > 0 &&
    summary.failed === 0 &&
    summary.browser === 0 &&
    !summary.youtubeLimited
  ) {
    toast.success(text);
    return;
  }
  if (
    summary.saved === 0 &&
    summary.duplicate === 0 &&
    summary.failed > 0 &&
    summary.browser === 0
  ) {
    toast.error(text);
    return;
  }
  toast.message(text);
}

export interface LinkQueueStatusProps {
  folders: Folder[];
  /** Opens a saved source in the app by its item id. */
  onOpenItem: (itemId: string) => void;
}

/**
 * While signed in, claims links the cloud left for this computer and saves them with Add links,
 * checks in so Claude and the extension can tell the app is open, and keeps a button in the top
 * bar that opens the "Links from Claude" panel. A toast reports each batch.
 */
export function LinkQueueStatus({ folders, onOpenItem }: LinkQueueStatusProps) {
  const { signedIn, offlineMode } = useAuth();
  const active = signedIn && !offlineMode;
  const [status, setStatus] = React.useState<{ label: string; detail: string } | null>(null);
  const [rows, setRows] = React.useState<LinkQueueRow[]>([]);
  const [seen, setSeen] = React.useState<LinkWorkersSeen | null>(null);
  const [lastLooked, setLastLooked] = React.useState(() => readLastLooked());
  const [panelOpen, setPanelOpen] = React.useState(false);
  const refreshRef = React.useRef<() => Promise<void>>(async () => {});
  // Starts the runner directly: link-queue writes (retry, claim) no longer reload the app.
  const startRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    if (!active) {
      setStatus(null);
      setRows([]);
      setSeen(null);
      setPanelOpen(false);
      return;
    }
    let alive = true;
    const ignoreRefresh = { current: false };
    let previous: Map<string, LinkQueueRow["status"]> | null = null;
    let latest: LinkQueueRow[] = [];
    let refreshing = false;

    const refresh = async () => {
      if (refreshing || !alive || !isRemoteConfigured()) return;
      refreshing = true;
      try {
        const [next, workers] = await Promise.all([
          listRecentLinks(),
          getLinkWorkers().catch(() => null),
        ]);
        if (!alive) return;
        const chromeSaved = detectChromeSaved(previous, next);
        previous = statusMap(next);
        latest = next;
        setRows(next);
        setSeen(workers);
        if (chromeSaved) {
          toast.message(formatChromeSavedToast(chromeSaved));
          ignoreRefresh.current = true;
          window.dispatchEvent(new Event("sourcefold:refresh"));
          ignoreRefresh.current = false;
        }
      } catch (error) {
        if (!isSessionExpiredError(error)) console.warn("Loading recent links failed.", error);
      } finally {
        refreshing = false;
      }
    };
    refreshRef.current = refresh;

    let version: string | null = null;
    const checkIn = async () => {
      try {
        version ??= await getAppVersion();
        await checkInDesktop(desktopWorkerId(), version);
      } catch {
        // The server may not have the table yet. Try again next minute.
      }
    };

    const showProgress = (progress: DrainProgress) => {
      if (!alive) return;
      const label = formatSavingStatus(progress.index, progress.total, progress.addedBy);
      setStatus({
        label,
        detail: formatSavingDetail(
          progress.index,
          progress.total,
          progress.addedBy,
          progress.pause,
        ),
      });
    };

    const runner = createLinkQueueRunner(
      async (ctx) => {
        await refresh();
        try {
          const summary = await drainDesktopQueue(
            createDesktopDrainHooks(ctx.signal, ctx.stopped, showProgress),
          );
          await refresh();
          return summary;
        } finally {
          if (alive) setStatus(null);
        }
      },
      {
        signedIn: () => isRemoteConfigured(),
        onFinished: (summary) => {
          if (!alive) return;
          const text = formatBatchToast(summary);
          if (text) showToast(summary, text);
          if (summary.libraryChanged) {
            // Reload groups and the open list. Ignore this event here so the drain doesn't
            // start again in the same turn (a YouTube limit would be claimed immediately).
            ignoreRefresh.current = true;
            window.dispatchEvent(new Event("sourcefold:refresh"));
            ignoreRefresh.current = false;
          }
        },
      },
    );

    const onRefresh = () => {
      if (ignoreRefresh.current) return;
      void runner.start();
    };
    const onAuth = () => {
      if (!isRemoteConfigured()) runner.stop();
    };
    window.addEventListener("sourcefold:refresh", onRefresh);
    window.addEventListener("sourcefold:auth-changed", onAuth);

    startRef.current = () => void runner.start();
    void checkIn();
    void runner.start();
    const checkInTimer = window.setInterval(() => {
      void checkIn();
      void refresh();
    }, CHECK_IN_MS);
    const openTimer = window.setInterval(() => {
      if (latest.some(isOpenRow)) void refresh();
    }, REFRESH_OPEN_MS);

    return () => {
      alive = false;
      runner.stop();
      window.clearInterval(checkInTimer);
      window.clearInterval(openTimer);
      window.removeEventListener("sourcefold:refresh", onRefresh);
      window.removeEventListener("sourcefold:auth-changed", onAuth);
      refreshRef.current = async () => {};
      startRef.current = () => {};
    };
  }, [active]);

  const openPanel = () => {
    const now = Date.now();
    writeLastLooked(now);
    setLastLooked(now);
    setPanelOpen(true);
    void refreshRef.current();
  };

  const onPanelChange = (open: boolean) => {
    setPanelOpen(open);
    if (!open) {
      const now = Date.now();
      writeLastLooked(now);
      setLastLooked(now);
    }
  };

  if (!active) return null;

  const summary = formatPillSummary(rows, seen, lastLooked);
  const show = status !== null || hasWorkToShow(rows, lastLooked);

  return (
    <>
      {show && (
        <button
          type="button"
          onClick={openPanel}
          title={status?.detail ?? "Links from Claude"}
          aria-label={status?.detail ?? `Links from Claude${summary ? `: ${summary}` : ""}`}
          className={cn(
            pill,
            "cursor-pointer transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
          )}
        >
          {status ? (
            <>
              <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
              <span className="hidden @[720px]/topbar:inline">{status.label}</span>
            </>
          ) : (
            <>
              <AppWindow className="size-4" aria-hidden="true" />
              {summary && <span className="hidden @[720px]/topbar:inline">{summary}</span>}
            </>
          )}
        </button>
      )}
      <LinksPanel
        open={panelOpen}
        onOpenChange={onPanelChange}
        rows={rows}
        seen={seen}
        folders={folders}
        onOpenItem={(itemId) => {
          onPanelChange(false);
          onOpenItem(itemId);
        }}
        onChanged={async () => {
          await refreshRef.current();
          startRef.current();
        }}
      />
    </>
  );
}
