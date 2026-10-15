import type { ParsedReaderFile } from "./parse-file";
import type { ReaderItem } from "./types";

export interface ReaderHeader {
  subtitle: string | null;
  author: string | null;
  publication: string | null;
  /** "Oct 12, 2026" or "Saved Oct 15, 2026"; the most telling date the file has. */
  dateLabel: string | null;
  /** The original page: the item's link, else the file's `url`. */
  url: string | null;
  domain: string | null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getReaderAuthor(item: ReaderItem): string | null {
  if (item.author) return item.author;
  const meta = item.meta;
  if (meta && typeof meta === "object") {
    const named = nonEmpty(meta.author) ?? nonEmpty(meta.byline) ?? nonEmpty(meta.author_name);
    if (named) return named;
    const handle = nonEmpty(meta.handle);
    if (handle) return handle.startsWith("@") ? handle : `@${handle}`;
  }
  return null;
}

export function getDomain(urlStr?: string | null): string | null {
  if (!urlStr) return null;
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** "2026-10-12" to "Oct 12, 2026", read as a calendar day so the time zone cannot move it. */
export function formatIsoDay(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function buildReaderHeader(item: ReaderItem, parsed: ParsedReaderFile | null): ReaderHeader {
  const fm = parsed?.frontMatter ?? {};
  const meta = (item.meta ?? {}) as Record<string, unknown>;

  const published = formatIsoDay(fm.published) ?? formatIsoDay(nonEmpty(meta.published));
  const posted = formatIsoDay(fm.posted) ?? formatIsoDay(nonEmpty(meta.posted));
  const created = formatIsoDay(fm.created);
  const saved = formatIsoDay(fm.saved) ?? formatIsoDay(item.created_at);
  const dateLabel = published ?? posted ?? created ?? (saved ? `Saved ${saved}` : null);

  const url = item.source_url || item.canonical_url || nonEmpty(fm.url);

  return {
    subtitle: parsed?.subtitle ?? nonEmpty(fm.subtitle) ?? nonEmpty(meta.subtitle),
    author: nonEmpty(fm.author) ?? getReaderAuthor(item),
    publication: nonEmpty(fm.publication) ?? nonEmpty(meta.publication),
    dateLabel,
    url,
    domain: getDomain(url),
  };
}

export function calculateReadingTime(text: string): string | null {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return null;
  return `${Math.max(1, Math.ceil(words / 200))} min read`;
}
