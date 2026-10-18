import type { Item } from "@/lib/types";
import type { NoteHit, PassageHit, SearchResponse } from "./search-api";

export interface SearchResults {
  sources: Item[];
  passages: PassageHit[];
  notes: NoteHit[];
  /** Whether the list on screen includes meaning results. */
  meaning: boolean;
  /** The query the passages and notes answer (what the reader should mark). */
  passagesFor: string;
}

export const EMPTY_RESULTS: SearchResults = {
  sources: [],
  passages: [],
  notes: [],
  meaning: false,
  passagesFor: "",
};

export type PassagePatch = Pick<SearchResults, "passages" | "notes" | "meaning" | "passagesFor">;

/**
 * What an index answer changes on screen (the passages and notes; titles come separately). The
 * answer with meaning is the better one, so a keyword-only answer that lands after it (they run in
 * parallel) is dropped: returns null then. `withMeaning` is whether one has already landed.
 */
export function foldResponse(
  response: SearchResponse,
  query: string,
  withMeaning: boolean,
): { patch: PassagePatch; withMeaning: boolean } | null {
  const used = response.meaning === "used";
  if (!used && withMeaning) return null;
  return {
    withMeaning: withMeaning || used,
    patch: {
      passages: response.passages,
      notes: response.notes,
      meaning: used,
      passagesFor: query,
    },
  };
}
