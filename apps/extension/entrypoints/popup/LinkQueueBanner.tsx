import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { LoaderCircle } from "lucide-react";
import type { LinkWorkersSeen } from "@sourcefold/core";
import { originPattern, progressText } from "../../lib/link-queue/copy";
import { LINK_QUEUE_MESSAGE } from "../../lib/link-queue/messages";
import {
  dismissLinkQueueRow,
  fetchLinkWorkers,
  listRecentAll,
  patchLinkQueue,
} from "../../lib/link-queue/queue-api";
import {
  LINK_QUEUE_STATE_KEY,
  normalizeLinkQueueState,
  readLinkQueueState,
} from "../../lib/link-queue/state";
import { viewRows, type LinkRowView } from "../../lib/link-queue/status";
import {
  EMPTY_LINK_QUEUE_STATE,
  type LinkQueueRow,
  type LinkQueueState,
} from "../../lib/link-queue/types";

const REFRESH_MS = 15_000;

/**
 * "Links from Claude": links an agent queued, newest first, with what happened to each.
 * Allow has to run here. `chrome.permissions.request` only works from a click.
 */
export function LinkQueueBanner() {
  const [state, setState] = useState<LinkQueueState>(EMPTY_LINK_QUEUE_STATE);
  const [rows, setRows] = useState<LinkQueueRow[]>([]);
  const [seen, setSeen] = useState<LinkWorkersSeen | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextRows, nextSeen] = await Promise.all([
      listRecentAll().catch(() => null),
      fetchLinkWorkers().catch(() => null),
    ]);
    if (nextRows) setRows(nextRows);
    setSeen(nextSeen);
  }, []);

  useEffect(() => {
    let ignore = false;
    void readLinkQueueState()
      .then((next) => {
        if (!ignore) setState(next);
      })
      .catch(() => {});
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== "local" || !(LINK_QUEUE_STATE_KEY in changes)) return;
      setState(normalizeLinkQueueState(changes[LINK_QUEUE_STATE_KEY]?.newValue));
      void load();
    };
    browser.storage.onChanged.addListener(onChanged);
    void browser.runtime.sendMessage({ type: LINK_QUEUE_MESSAGE, op: "kick" }).catch(() => {});
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      ignore = true;
      clearInterval(timer);
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [load]);

  const views = viewRows(rows, seen);
  if (!state.progress && views.length === 0) return null;

  const run = (id: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(id);
    void action()
      .catch(() => {})
      .then(() => load())
      .finally(() => setBusy(null));
  };

  const allow = (view: LinkRowView) => {
    const origin = originPattern(view.row.url);
    if (!origin) return;
    // Asked straight from the click; "retry" then puts the links set aside for this site back in line.
    const requested = browser.permissions.request({ origins: [origin] });
    run(view.row.id, async () => {
      if (await requested) {
        await browser.runtime.sendMessage({ type: LINK_QUEUE_MESSAGE, op: "retry" });
      }
    });
  };

  const retry = (view: LinkRowView) =>
    run(view.row.id, async () => {
      await patchLinkQueue(view.row.id, { status: "waiting", needs: "browser" });
      await browser.runtime.sendMessage({ type: LINK_QUEUE_MESSAGE, op: "kick" });
    });

  const dismiss = (view: LinkRowView) => run(view.row.id, () => dismissLinkQueueRow(view.row.id));

  return (
    <div className="queue-banner" role="status" aria-live="polite">
      {state.progress && (
        <p className="queue-line">
          <LoaderCircle size={14} className="spin" aria-hidden="true" />
          <span>{progressText(state.progress)}</span>
        </p>
      )}
      {views.length > 0 && (
        <>
          <p className="queue-heading">Links from Claude</p>
          <ul className="queue-list">
            {views.map((view) => (
              <li key={view.row.id} className="queue-item">
                <div className="queue-item-text">
                  <p className="queue-item-title" title={view.row.url}>
                    {view.title}
                  </p>
                  <p className="queue-item-status">
                    <strong>{view.status.label}</strong>
                    {view.status.hint ? ` · ${view.status.hint}` : ""}
                  </p>
                </div>
                {(view.allow || view.retry || view.dismiss) && (
                  <div className="queue-item-actions">
                    {view.allow && (
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => allow(view)}
                        disabled={busy !== null}
                      >
                        Allow
                      </button>
                    )}
                    {view.retry && (
                      <button
                        type="button"
                        className="btn-outline btn-sm"
                        onClick={() => retry(view)}
                        disabled={busy !== null}
                      >
                        Retry
                      </button>
                    )}
                    {view.dismiss && (
                      <button
                        type="button"
                        className="btn-outline btn-sm"
                        onClick={() => dismiss(view)}
                        disabled={busy !== null}
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
