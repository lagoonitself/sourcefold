/**
 * A comparable form of a link: no fragment, no trailing slash, lower-case host, no "www.".
 * Used to tell whether a cited reference is already saved in the open group.
 */
export function urlKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${host}${path}${parsed.search}`;
  } catch {
    return null;
  }
}

/** Keys of every source link in a list of items (canonical and original). */
export function savedUrlKeys(
  items: ReadonlyArray<{ source_url?: string | null; canonical_url?: string | null }>,
): Set<string> {
  const keys = new Set<string>();
  for (const item of items) {
    for (const url of [item.canonical_url, item.source_url]) {
      const key = urlKey(url);
      if (key) keys.add(key);
    }
  }
  return keys;
}
