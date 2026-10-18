import type { Item } from "@/lib/types";
import type { NoteHit, PassageHit } from "./search-api";

/** One selectable line of the search box. Arrow keys move across all of them. */
export type SearchRow =
  | { key: string; type: "source"; item: Item }
  | { key: string; type: "passage"; hit: PassageHit }
  | { key: string; type: "note"; hit: NoteHit };

export const SECTION_TITLES: Record<SearchRow["type"], string> = {
  source: "Sources",
  passage: "Passages",
  note: "Highlights and notes",
};

/** Titles first, then passages, then highlights and notes, each with a key that survives a re-query. */
export function buildRows(
  sources: readonly Item[],
  passages: readonly PassageHit[],
  notes: readonly NoteHit[],
): SearchRow[] {
  const seen = new Map<string, number>();
  const unique = (base: string) => {
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  };
  return [
    ...sources.map((item): SearchRow => ({
      key: unique(`source:${item.id}`),
      type: "source",
      item,
    })),
    ...passages.map((hit): SearchRow => ({
      key: unique(`passage:${hit.item_id}:${hit.passage_start}`),
      type: "passage",
      hit,
    })),
    ...notes.map((hit): SearchRow => ({
      key: unique(`note:${hit.item_id}:${hit.source}:${hit.passage_start}`),
      type: "note",
      hit,
    })),
  ];
}

/** Index of the selected row: the row with `selectedKey` if it is still listed, else the first. */
export function selectedIndexOf(rows: readonly SearchRow[], selectedKey: string | null): number {
  if (selectedKey === null) return 0;
  const at = rows.findIndex((row) => row.key === selectedKey);
  return at === -1 ? 0 : at;
}

/** The index one step away, wrapping at both ends. */
export function stepIndex(current: number, delta: 1 | -1, length: number): number {
  if (length === 0) return 0;
  return (current + delta + length) % length;
}
