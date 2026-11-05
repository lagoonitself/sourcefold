// The Link Shelf (docs/dev/PLAN-shelf.md): sites the user keeps with a note, without saving the
// page as a source. Stored in Supabase `shelf_links` and, offline, SQLite `shelf_links`.

export interface ShelfLink {
  id: string;
  url: string;
  /** `shelfKey(url)`: two links with the same key are the same link. */
  key: string;
  title: string;
  note: string;
  tags: string[];
  pinned: boolean;
  open_count: number;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShelfLinkInput {
  url: string;
  title?: string;
  note?: string;
  tags?: string[];
  pinned?: boolean;
}

export interface ShelfLinkPatch {
  url?: string;
  title?: string;
  note?: string;
  tags?: string[];
  pinned?: boolean;
}

export interface ShelfAddResult {
  added: ShelfLink[];
  existing: ShelfLink[];
}

export const SHELF_LIMITS = {
  url: 2048,
  title: 300,
  note: 8000,
  tags: 20,
  tag: 40,
  batch: 500,
} as const;

/**
 * The duplicate key of a link: http(s) only, host lowercased without `www.`, default port,
 * hash and trailing slash dropped. The query is kept: for many sites (dashboards, searches) it is
 * what makes the link. Null for anything that isn't an http(s) URL.
 */
export function shelfKey(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  const port =
    parsed.port && parsed.port !== "80" && parsed.port !== "443" ? `:${parsed.port}` : "";
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${host}${port}${path}${parsed.search}`;
}

/** The URL as typed, with `https://` added when the scheme is missing. Null when it can't be read. */
export function normalizeShelfUrl(input: string): string | null {
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname || (!parsed.hostname.includes(".") && parsed.hostname !== "localhost")) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/** The title to show when the user gave none: the host without `www.`. */
export function shelfTitleFallback(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url;
  }
}

/** The host to show under a link's title. */
export function shelfHost(url: string): string {
  return shelfTitleFallback(url);
}

/** Tags trimmed, without a leading `#`, inner spaces collapsed, case-insensitively unique. */
export function normalizeShelfTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = raw
      .trim()
      .replace(/^#+/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, SHELF_LIMITS.tag)
      .trim();
    if (!tag) continue;
    const lower = tag.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(tag);
    if (out.length >= SHELF_LIMITS.tags) break;
  }
  return out;
}

/** Splits "a, b, #c" as typed in a tags field. */
export function parseShelfTagsText(text: string): string[] {
  return normalizeShelfTags(text.split(","));
}

const HALF_LIFE_DAYS = 14;
const DAY_MS = 86_400_000;

/** How high a link sorts: pinned first, then opens fading with a two-week half-life. */
export function shelfScore(link: ShelfLink, now: Date = new Date()): number {
  let score = link.pinned ? 1e9 : 0;
  if (link.open_count > 0 && link.last_opened_at) {
    const opened = Date.parse(link.last_opened_at);
    const days = Number.isFinite(opened) ? Math.max(0, (now.getTime() - opened) / DAY_MS) : 0;
    score += link.open_count * Math.pow(0.5, days / HALF_LIFE_DAYS);
  }
  return score;
}

/** Pinned first, then most used, then never-opened links newest first. A new array. */
export function sortShelf(links: ShelfLink[], now: Date = new Date()): ShelfLink[] {
  return [...links].sort((a, b) => {
    const diff = shelfScore(b, now) - shelfScore(a, now);
    if (diff !== 0) return diff;
    return b.created_at.localeCompare(a.created_at);
  });
}

/** Whether a link matches a filter text (title, URL, note or a tag, case-insensitive). */
export function shelfMatches(link: ShelfLink, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    link.title.toLowerCase().includes(q) ||
    link.url.toLowerCase().includes(q) ||
    link.note.toLowerCase().includes(q) ||
    link.tags.some((t) => t.toLowerCase().includes(q))
  );
}

/** Every tag on the shelf with how many links carry it, most used first. */
export function shelfTagCounts(links: ShelfLink[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const link of links) {
    for (const tag of link.tags) {
      const key = tag.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Splits pasted text into URLs: one per line (or separated by spaces), anything that doesn't read
 * as a URL dropped, duplicates (by key) dropped.
 */
export function parseShelfUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/\s+/)) {
    const url = normalizeShelfUrl(part);
    if (!url) continue;
    const key = shelfKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripTags(text: string): string {
  return decodeEntities(text.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

const TOOLBAR_FOLDERS = new Set([
  "bookmarks bar",
  "bookmarks toolbar",
  "favorites bar",
  "other bookmarks",
  "mobile bookmarks",
  "bookmarks menu",
  "favourites bar",
]);

/**
 * Reads a browser's `bookmarks.html` export (the Netscape format Chrome, Edge, Firefox and Safari
 * write). Each link gets its folder path as tags, without the browser's own top folders. Links
 * that aren't http(s) are skipped; the same link twice is kept once.
 */
export function parseBookmarksHtml(html: string): { url: string; title: string; tags: string[] }[] {
  const out: { url: string; title: string; tags: string[] }[] = [];
  const seen = new Set<string>();
  const folders: (string | null)[] = [];
  let pendingFolder: string | null = null;
  const token = /<h3[^>]*>([\s\S]*?)<\/h3>|<a\s([^>]*)>([\s\S]*?)<\/a>|<dl[^>]*>|<\/dl>/gi;
  let match: RegExpExecArray | null;
  while ((match = token.exec(html))) {
    const whole = match[0].toLowerCase();
    if (match[1] !== undefined) {
      pendingFolder = stripTags(match[1]);
    } else if (match[2] !== undefined) {
      const href = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(match[2]);
      const raw = href ? decodeEntities(href[1] ?? href[2] ?? "") : "";
      const url = normalizeShelfUrl(raw);
      if (!url || !/^https?:/i.test(raw.trim())) continue;
      const key = shelfKey(url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const tags = normalizeShelfTags(
        folders.filter((f): f is string => !!f && !TOOLBAR_FOLDERS.has(f.toLowerCase())),
      );
      const title =
        stripTags(match[3] ?? "").slice(0, SHELF_LIMITS.title) || shelfTitleFallback(url);
      out.push({ url, title, tags });
    } else if (whole.startsWith("<dl")) {
      folders.push(pendingFolder);
      pendingFolder = null;
    } else {
      folders.pop();
    }
  }
  return out;
}
