import type { HighlightCitation } from "../highlights";

/** Pure helpers behind a highlight's `seconds` and `cited` fields. */

export interface TimestampMark {
  /** Text offset where the transcript line's timestamp link starts. */
  offset: number;
  seconds: number;
}

const TIMESTAMP_LABEL = /^\d{1,2}(?::\d{2}){1,2}$/;

export function isTimestampLabel(text: string): boolean {
  return TIMESTAMP_LABEL.test(text.trim());
}

/** Seconds from a YouTube link's `t` parameter: `?t=47`, `&t=47s`, `?t=1h2m3s`. */
export function parseTimestampHref(href: string): number | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "youtu.be" && !host.endsWith("youtube.com")) return null;
  const raw = url.searchParams.get("t") ?? url.searchParams.get("start");
  if (!raw) return null;
  if (/^\d+s?$/.test(raw)) return parseInt(raw, 10);
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!parts || !(parts[1] || parts[2] || parts[3])) return null;
  return Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
}

/**
 * Seconds of the last timestamp at or before `offset`; null when the text starts earlier, or at or
 * after `end` (where the transcript stops and, say, the description begins).
 */
export function secondsAt(
  marks: ReadonlyArray<TimestampMark>,
  offset: number,
  end = Infinity,
): number | null {
  if (offset >= end) return null;
  let found: number | null = null;
  let foundOffset = -1;
  for (const mark of marks) {
    if (mark.offset <= offset && mark.offset >= foundOffset) {
      found = mark.seconds;
      foundOffset = mark.offset;
    }
  }
  return found;
}

export interface FootnoteRef {
  /** Text offset of the `[12]` marker. */
  offset: number;
  label: string;
}

export interface FootnoteDef {
  label: string;
  title: string | null;
  url: string;
}

export interface FootnoteParts {
  /** The definition's text, without its `[n]` label. */
  text: string;
  links: ReadonlyArray<{ href: string; text: string }>;
}

function isWebUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Title and address of one reference. `[title](url) - domain` gives the link text as the title;
 * `<url> - domain`, or a bare address, has no title.
 */
export function parseFootnoteDefinition(label: string, parts: FootnoteParts): FootnoteDef | null {
  const link = parts.links.find((l) => isWebUrl(l.href));
  let url: string | null = link ? link.href : null;
  let title: string | null = null;
  // A bare address in the text counts when there is no link.

  if (link) {
    const linkText = link.text.trim();
    if (linkText && !isWebUrl(linkText) && linkText !== link.href) title = linkText;
  } else {
    const bare = /https?:\/\/[^\s<>)\]]+/.exec(parts.text);
    if (bare) url = bare[0].replace(/[.,;]+$/, "");
  }
  if (!url) return null;

  return { label, title, url };
}

/** The references whose markers sit inside [start, end), once each, in reading order. */
export function citationsInRange(
  refs: ReadonlyArray<FootnoteRef>,
  defs: ReadonlyMap<string, FootnoteDef>,
  start: number,
  end: number,
  limit = 50,
): HighlightCitation[] {
  const seen = new Set<string>();
  const cited: HighlightCitation[] = [];
  for (const ref of refs) {
    if (ref.offset < start || ref.offset >= end || seen.has(ref.label)) continue;
    const def = defs.get(ref.label);
    if (!def) continue;
    seen.add(ref.label);
    cited.push({ n: ref.label, title: def.title, url: def.url });
    if (cited.length >= limit) break;
  }
  return cited;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
