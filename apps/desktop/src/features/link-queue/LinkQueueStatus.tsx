import * as React from "react";
import { AppWindow, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth";
import { isRemoteConfigured, isSessionExpiredError } from "@/lib/remote-client";
import { cn } from "@/lib/utils";
import { listBrowserQueue } from "./api";
import {
  formatBatchToast,
  formatChromeHint,
  formatChromeWaiting,
  formatSavingDetail,
  formatSavingStatus,
} from "./copy";
import { createDesktopDrainHooks } from "./desktop-hooks";
import { drainDesktopQueue } from "./drain";
import { createLinkQueueRunner } from "./runner";
import type { BatchSummary, DrainProgress } from "./types";

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

/**
 * While signed in, claims links the cloud left for this computer and saves them with Add links.
 * A quiet status sits in the top bar; a toast reports the batch.
 */
export function LinkQueueStatus() {
  const { signedIn, offlineMode } = useAuth();
  const active = signedIn && !offlineMode;
  const [status, setStatus] = React.useState<{ label: string; detail: string } | null>(null);
  const [chromeCount, setChromeCount] = React.useState(0);

  React.useEffect(() => {
    if (!active) {
      setStatus(null);
      setChromeCount(0);
      return;
    }
    let alive = true;
    const ignoreRefresh = { current: false };

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
        const reportChrome = async () => {
          try {
            const open = await listBrowserQueue();
            if (alive && !ctx.stopped()) setChromeCount(open.length);
          } catch (error) {
            if (isSessionExpiredError(error)) throw error;
          }
        };
        await reportChrome();
        try {
          const summary = await drainDesktopQueue(
            createDesktopDrainHooks(ctx.signal, ctx.stopped, showProgress),
          );
          await reportChrome();
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
    void runner.start();

    return () => {
      alive = false;
      runner.stop();
      window.removeEventListener("sourcefold:refresh", onRefresh);
      window.removeEventListener("sourcefold:auth-changed", onAuth);
    };
  }, [active]);

  if (!active || (!status && chromeCount === 0)) return null;

  const chromeHint = chromeCount > 0 ? formatChromeHint(chromeCount) : null;

  return (
    <>
      {status && (
        <div role="status" aria-live="polite" className={pill} title={status.detail}>
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
          <span className="hidden @[720px]/topbar:inline">{status.label}</span>
        </div>
      )}
      {chromeHint && (
        <div role="status" className={cn(pill, "cursor-default")} title={chromeHint}>
          <AppWindow className="size-4" aria-hidden="true" />
          <span className="hidden @[860px]/topbar:inline">{formatChromeWaiting(chromeCount)}</span>
          <span className="sr-only">{chromeHint}</span>
        </div>
      )}
    </>
  );
}
