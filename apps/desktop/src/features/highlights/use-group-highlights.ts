import * as React from "react";
import type { Highlight } from "@sourcefold/core";
import { getHighlights } from "@/lib/api";
import { isSessionExpiredError } from "@/lib/remote-client";
import { errorMessage } from "@/lib/utils";

export interface GroupHighlights {
  highlights: Highlight[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** The highlights of the sources directly in a group; reloads on the app's refresh events. */
export function useGroupHighlights(folderId: string | null): GroupHighlights {
  const [state, setState] = React.useState<{
    folderId: string | null;
    highlights: Highlight[];
    error: string | null;
    loaded: boolean;
  }>({ folderId: null, highlights: [], error: null, loaded: false });
  const requestRef = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!folderId) {
      setState({ folderId: null, highlights: [], error: null, loaded: true });
      return;
    }
    try {
      const data = await getHighlights({ folderId });
      if (requestId !== requestRef.current) return;
      setState({ folderId, highlights: data, error: null, loaded: true });
    } catch (err) {
      if (requestId !== requestRef.current || isSessionExpiredError(err)) return;
      setState((prev) => ({
        folderId,
        highlights: prev.folderId === folderId ? prev.highlights : [],
        error: errorMessage(err, "Couldn't load highlights."),
        loaded: true,
      }));
    }
  }, [folderId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    const reload = () => void refresh();
    window.addEventListener("sourcefold:refresh", reload);
    window.addEventListener("sourcefold:auth-changed", reload);
    return () => {
      window.removeEventListener("sourcefold:refresh", reload);
      window.removeEventListener("sourcefold:auth-changed", reload);
    };
  }, [refresh]);

  const current = state.folderId === folderId;
  return {
    highlights: current ? state.highlights : [],
    loading: !current || !state.loaded,
    error: current ? state.error : null,
    refresh,
  };
}
