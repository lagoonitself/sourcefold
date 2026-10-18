import * as React from "react";
import { isTauri, searchItems } from "@/lib/api";
import { embedQuery } from "./embedding";
import { createLatestGate } from "./latest-gate";
import { EMPTY_RESULTS, foldResponse, type SearchResults } from "./merge";
import {
  EMBEDDING_MODEL_KEY,
  searchQuery,
  type SearchResponse,
  type SearchScope,
} from "./search-api";

export type { SearchResults };

/** Keyword search starts this long after the last keystroke. */
export const SEARCH_DEBOUNCE_MS = 120;
/** Title matches shown above the passages. */
export const SOURCE_LIMIT = 3;

export interface UseSearchState extends SearchResults {
  /** True while the answer to the current query has not arrived yet (old results stay shown). */
  pending: boolean;
  /** The text in the box, trimmed, that `sources`, `passages` and `notes` answer. */
  answeredQuery: string;
}

export interface UseSearchArgs {
  open: boolean;
  query: string;
  scope: SearchScope;
  projectId: string | null;
}

/**
 * Titles (always), plus passages and notes from the desktop index. Keyword answers show as soon as
 * they arrive; when search by meaning is on, the query is embedded at the same time and the search
 * runs again with its vector, replacing the list. Stale answers are dropped by sequence number, and
 * the old list stays on screen while a new one is on its way.
 */
export function useSearch({ open, query, scope, projectId }: UseSearchArgs): UseSearchState {
  const [results, setResults] = React.useState<SearchResults>(EMPTY_RESULTS);
  const [answered, setAnswered] = React.useState({ key: "", query: "" });
  const gateRef = React.useRef(createLatestGate());

  const trimmed = query.trim();
  const key = `${scope}\u0000${scope === "project" ? (projectId ?? "") : ""}\u0000${trimmed}`;

  React.useEffect(() => {
    const gate = gateRef.current;
    if (!open || !trimmed) {
      gate.cancel();
      setResults(EMPTY_RESULTS);
      setAnswered({ key: "", query: "" });
      return;
    }
    const projectScope = scope === "project" ? projectId : null;
    const timer = window.setTimeout(() => {
      const seq = gate.next();
      const fresh = () => gate.isLatest(seq);
      const done = () => {
        if (fresh()) setAnswered({ key, query: trimmed });
      };

      // Titles do not need the index, so they also work in the web build and with Local copy off.
      const titles = searchItems(trimmed, projectScope)
        .then((items) => {
          if (fresh()) setResults((prev) => ({ ...prev, sources: items.slice(0, SOURCE_LIMIT) }));
        })
        .catch((e) => {
          if (fresh()) setResults((prev) => ({ ...prev, sources: [] }));
          console.error("Title search error", e);
        });

      if (!isTauri()) {
        void titles.then(done);
        return;
      }

      // The answer with meaning is the better one; a keyword answer that lands after it is dropped.
      let withMeaning = false;
      const apply = (response: SearchResponse) => {
        if (!fresh()) return;
        const folded = foldResponse(response, trimmed, withMeaning);
        if (!folded) return;
        withMeaning = folded.withMeaning;
        setResults((prev) => ({ ...prev, ...folded.patch }));
      };

      const keywords = searchQuery({ query: trimmed, scope, projectId })
        .then(apply)
        .catch((e) => {
          if (fresh())
            setResults((prev) => ({
              ...prev,
              passages: [],
              notes: [],
              meaning: false,
              passagesFor: "",
            }));
          console.error("Passage search error", e);
        });
      void Promise.all([titles, keywords]).then(done);

      void embedQuery(trimmed).then((vector) => {
        if (!vector || !fresh()) return;
        return searchQuery({
          query: trimmed,
          scope,
          projectId,
          queryVector: vector,
          model: EMBEDDING_MODEL_KEY,
        })
          .then(apply)
          .catch((e) => console.error("Meaning search error", e));
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open, trimmed, scope, projectId, key]);

  // Leaving the box (or closing it) drops anything still on its way.
  React.useEffect(() => {
    const gate = gateRef.current;
    return () => gate.cancel();
  }, []);

  const pending = Boolean(trimmed) && answered.key !== key;
  return { ...results, pending, answeredQuery: answered.query };
}
