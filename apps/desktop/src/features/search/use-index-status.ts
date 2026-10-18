import * as React from "react";
import { isTauri } from "@/lib/api";
import { createLatestGate } from "./latest-gate";
import { EMBEDDING_MODEL_KEY, getSearchStatus, type SearchStatus } from "./search-api";

/** How often the footer's counts refresh while the search box is open. */
export const STATUS_POLL_MS = 1500;

/**
 * The index's state for the scope shown (one project, or all), refreshed every 1.5 s while the box
 * is open. Null until the first answer, and always null outside the desktop app.
 */
export function useIndexStatus(open: boolean, projectId: string | null): SearchStatus | null {
  const [status, setStatus] = React.useState<SearchStatus | null>(null);

  React.useEffect(() => {
    if (!open || !isTauri()) return;
    const gate = createLatestGate();
    let timer: number | undefined;
    let stopped = false;

    const poll = () => {
      const seq = gate.next();
      getSearchStatus(projectId, EMBEDDING_MODEL_KEY)
        .then((next) => {
          if (gate.isLatest(seq) && !stopped) setStatus(next);
        })
        .catch(() => {})
        .finally(() => {
          if (!stopped) timer = window.setTimeout(poll, STATUS_POLL_MS);
        });
    };
    poll();

    return () => {
      stopped = true;
      gate.cancel();
      window.clearTimeout(timer);
    };
  }, [open, projectId]);

  return open ? status : null;
}
