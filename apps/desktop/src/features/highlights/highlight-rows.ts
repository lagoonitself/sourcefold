import type { Highlight, HighlightInput } from "@sourcefold/core";

/** A highlight with the source it belongs to. */
export interface HighlightRow<TItem extends { id: string }> {
  highlight: Highlight;
  item: TItem;
}

export type GroupTab = "sources" | "highlights";

/**
 * One row per highlight whose source is in `items`, ordered by the sources' list order, then
 * `start_offset`, then `created_at`, then id. Highlights of sources that are not listed (moved or
 * deleted) are left out.
 */
export function buildHighlightRows<TItem extends { id: string }>(
  highlights: readonly Highlight[],
  items: readonly TItem[],
): HighlightRow<TItem>[] {
  const order = new Map<string, number>();
  items.forEach((item, index) => order.set(item.id, index));

  const rows: HighlightRow<TItem>[] = [];
  for (const highlight of highlights) {
    const index = order.get(highlight.item_id);
    if (index === undefined) continue;
    rows.push({ highlight, item: items[index] });
  }

  return rows.sort((a, b) => {
    const byItem = order.get(a.item.id)! - order.get(b.item.id)!;
    if (byItem !== 0) return byItem;
    if (a.highlight.start_offset !== b.highlight.start_offset) {
      return a.highlight.start_offset - b.highlight.start_offset;
    }
    if (a.highlight.created_at !== b.highlight.created_at) {
      return a.highlight.created_at < b.highlight.created_at ? -1 : 1;
    }
    return a.highlight.id < b.highlight.id ? -1 : a.highlight.id > b.highlight.id ? 1 : 0;
  });
}

/**
 * The new selection after clicking row `id`. With `shiftKey` and a previous click, the whole range
 * between the two takes the state the clicked row is switching to (like the sources list).
 */
export function toggleSelection(
  orderedIds: readonly string[],
  selected: ReadonlySet<string>,
  id: string,
  lastId: string | null,
  shiftKey: boolean,
): Set<string> {
  const next = new Set(selected);
  const select = !next.has(id);
  if (shiftKey && lastId) {
    const from = orderedIds.indexOf(lastId);
    const to = orderedIds.indexOf(id);
    if (from !== -1 && to !== -1) {
      for (const rangeId of orderedIds.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        if (select) next.add(rangeId);
        else next.delete(rangeId);
      }
    }
  }
  if (select) next.add(id);
  else next.delete(id);
  return next;
}

/** What "Copy with sources" copies: the selected rows, or every row when none is selected. */
export function rowsToCopy<TItem extends { id: string }>(
  rows: readonly HighlightRow<TItem>[],
  selected: ReadonlySet<string>,
): HighlightRow<TItem>[] {
  if (selected.size === 0) return [...rows];
  return rows.filter((row) => selected.has(row.highlight.id));
}

export function copiedMessage(count: number): string {
  return count === 1
    ? "Copied 1 highlight with sources"
    : `Copied ${count} highlights with sources`;
}

/** Drops the selection of highlights that are no longer listed. */
export function pruneSelection(
  selected: ReadonlySet<string>,
  orderedIds: readonly string[],
): Set<string> {
  const ids = new Set(orderedIds);
  return new Set([...selected].filter((id) => ids.has(id)));
}

/** The highlight as the client sends it back, e.g. to undo a delete. */
export function toHighlightInput(highlight: Highlight): HighlightInput {
  const { created_at: _created, updated_at: _updated, ...input } = highlight;
  return input;
}

/** "sae.org" for "https://www.sae.org/paper"; the text itself when it is not a URL. */
export function citedDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

/** "cited sae.org, nature.com" without repeats; null when nothing is cited. */
export function citedLabel(cited: Highlight["cited"]): string | null {
  const domains = [...new Set(cited.map((c) => citedDomain(c.url)))];
  return domains.length > 0 ? `cited ${domains.join(", ")}` : null;
}

export function toggleGroupTab(tab: GroupTab): GroupTab {
  return tab === "sources" ? "highlights" : "sources";
}

interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** Shift+H in the list region switches between the Sources and Highlights tabs. */
export function isTabSwitchKey(e: KeyLike): boolean {
  return e.key === "H" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/** The tab shown for `folderId`: the one chosen there, Sources after another group is opened. */
export function tabFor(
  chosen: { folderId: string | null; tab: GroupTab },
  folderId: string | null,
) {
  return chosen.folderId === folderId ? chosen.tab : "sources";
}
