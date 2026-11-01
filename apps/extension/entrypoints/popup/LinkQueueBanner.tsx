import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { LoaderCircle } from "lucide-react";
import { failedBannerText, permissionBannerText, progressText } from "../../lib/link-queue/copy";
import { LINK_QUEUE_MESSAGE } from "../../lib/link-queue/messages";
import {
  LINK_QUEUE_STATE_KEY,
  normalizeLinkQueueState,
  readLinkQueueState,
} from "../../lib/link-queue/state";
import { EMPTY_LINK_QUEUE_STATE, type LinkQueueState } from "../../lib/link-queue/types";

/**
 * Links Claude (or another agent) queued for this browser: permission, progress, and Retry.
 * Allow has to run here. `chrome.permissions.request` only works from a click.
 */
export function LinkQueueBanner() {
  const [state, setState] = useState<LinkQueueState>(EMPTY_LINK_QUEUE_STATE);
  const [allowing, setAllowing] = useState(false);
  const [retrying, setRetrying] = useState(false);

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
    };
    browser.storage.onChanged.addListener(onChanged);
    void browser.runtime.sendMessage({ type: LINK_QUEUE_MESSAGE, op: "kick" }).catch(() => {});
    return () => {
      ignore = true;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  if (!state.permission && !state.progress && !state.failed) return null;

  const allow = () => {
    const origins = state.permission?.origins ?? [];
    if (!origins.length || allowing) return;
    const requested = browser.permissions.request({ origins });
    setAllowing(true);
    void requested
      .then((granted) => {
        if (granted) return browser.runtime.sendMessage({ type: LINK_QUEUE_MESSAGE, op: "kick" });
      })
      .finally(() => setAllowing(false));
  };

  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    void browser.runtime
      .sendMessage({ type: LINK_QUEUE_MESSAGE, op: "retry" })
      .finally(() => setRetrying(false));
  };

  const retryClass = state.permission ? "btn-outline btn-sm" : "btn-primary btn-sm";

  return (
    <div className="queue-banner" role="status" aria-live="polite">
      {state.progress && (
        <p className="queue-line">
          <LoaderCircle size={14} className="spin" aria-hidden="true" />
          <span>{progressText(state.progress)}</span>
        </p>
      )}
      {state.permission && (
        <div className="queue-line">
          <p>{permissionBannerText(state.permission.count, state.permission.hosts)}</p>
          <button type="button" className="btn-primary btn-sm" onClick={allow} disabled={allowing}>
            Allow
          </button>
        </div>
      )}
      {state.failed && (
        <div className="queue-line">
          <p>{failedBannerText(state.failed.count, state.failed.message)}</p>
          <button type="button" className={retryClass} onClick={retry} disabled={retrying}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
