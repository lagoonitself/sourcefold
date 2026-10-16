/** Which saved sources have text the reader can show. Images open in the image viewer. */
export const READER_KINDS: ReadonlySet<string> = new Set([
  "grokipedia",
  "substack",
  "x",
  "wikipedia",
  "note",
  "youtube",
  "web",
  "reddit",
  "pdf",
  "hackernews",
  "bluesky",
]);

export interface OpenableItem {
  kind: string;
  source_url?: string | null;
  canonical_url?: string | null;
  markdown?: string | null;
  status?: string | null;
}

export type OpenTarget = "reader" | "browser" | "image" | "none";

export function linkOfItem(
  item: Pick<OpenableItem, "source_url" | "canonical_url">,
): string | null {
  return item.source_url || item.canonical_url || null;
}

/** True when the reader can show this source (its text is loaded when the reader opens). */
export function opensInReader(item: OpenableItem): boolean {
  if (READER_KINDS.has(item.kind)) return true;
  // A kind added later still shows in the reader when its text is already at hand.
  return item.kind !== "image" && Boolean(item.markdown && item.markdown.trim());
}

/**
 * What Enter does on a source: images open in the image viewer, text sources in the reader,
 * anything else in the browser. `forceExternal` (Shift+Enter, "o") prefers the original page and
 * only falls back to the reader for a source with no link, such as a note.
 */
export function openTargetFor(item: OpenableItem, forceExternal = false): OpenTarget {
  if (item.kind === "image") return "image";
  const url = linkOfItem(item);
  // Nothing was saved (a locked post, a video without captions): show the original page.
  if (item.status === "unavailable" && url) return "browser";
  if (forceExternal) {
    if (url) return "browser";
    return opensInReader(item) ? "reader" : "none";
  }
  if (opensInReader(item)) return "reader";
  return url ? "browser" : "none";
}

export interface OpenHandlers<T extends OpenableItem> {
  reader: (item: T) => void;
  browser: (url: string, item: T) => void;
  image: (item: T) => void;
}

/** Opens `item` the way `openTargetFor` says. Returns what was chosen. */
export function openSource<T extends OpenableItem>(
  item: T,
  handlers: OpenHandlers<T>,
  options?: { forceExternal?: boolean },
): OpenTarget {
  const target = openTargetFor(item, options?.forceExternal);
  if (target === "image") handlers.image(item);
  else if (target === "reader") handlers.reader(item);
  else if (target === "browser") handlers.browser(linkOfItem(item) as string, item);
  return target;
}
