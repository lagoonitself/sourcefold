// Highlights: the shared shape and the formatting helpers (docs/dev/handoff-highlights.md).
// Pure and browser-safe: no Node APIs.

export type HighlightKind = "text" | "image";

/** A reference cited inside the highlighted passage (Grokipedia / Wikipedia footnote). */
export interface HighlightCitation {
  /** Footnote label, e.g. "12". */
  n: string;
  title: string | null;
  url: string;
}

export interface Highlight {
  /** uuid, made by the client. */
  id: string;
  item_id: string;
  kind: HighlightKind;
  /** The highlighted text; for an image, its alt text. */
  quote: string;
  /** Up to 32 characters of body text before the quote. */
  prefix: string;
  /** Up to 32 characters of body text after the quote. */
  suffix: string;
  /** Offsets into the reader's rendered body text. */
  start_offset: number;
  end_offset: number;
  image_src: string | null;
  note: string | null;
  /** YouTube: start of the transcript line the highlight begins in. */
  seconds: number | null;
  cited: HighlightCitation[];
  created_at: string;
  updated_at: string;
}

/** What the client sends to create or replace a highlight. */
export type HighlightInput = Omit<Highlight, "created_at" | "updated_at">;

export const HIGHLIGHT_LIMITS = {
  quote: 10_000,
  note: 5_000,
  context: 64,
  cited: 50,
} as const;

/** The fields of a highlight that go into the `## My highlights` section of a file. */
export type FileHighlight = Pick<
  Highlight,
  | "id"
  | "kind"
  | "quote"
  | "image_src"
  | "note"
  | "seconds"
  | "cited"
  | "start_offset"
  | "created_at"
>;

export interface CopySource {
  title: string;
  /** e.g. ["Engineering Explained", "YouTube"]; empty parts are dropped. */
  byline: string[];
  url: string | null;
}

function str(val: unknown): string | undefined {
  return typeof val === "string" && val.trim() ? val.trim() : undefined;
}

function hostOf(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function copySourceFromItem(item: {
  kind: string;
  title: string;
  source_url?: string | null;
  canonical_url?: string | null;
  meta?: Record<string, unknown> | null;
}): CopySource {
  const meta = item.meta ?? {};
  const url = str(item.canonical_url) ?? str(item.source_url) ?? null;
  let parts: (string | undefined)[];
  switch (item.kind) {
    case "youtube":
      parts = [str(meta.channel), "YouTube"];
      break;
    case "substack":
      parts = [str(meta.author), str(meta.publication) ?? "Substack"];
      break;
    case "grokipedia":
      parts = ["Grokipedia"];
      break;
    case "wikipedia":
      parts = ["Wikipedia"];
      break;
    case "x":
      parts = [str(meta.author), "X"];
      break;
    case "web":
      parts = [str(meta.author), str(meta.site) ?? hostOf(url)];
      break;
    case "reddit": {
      const sub = str(meta.subreddit);
      parts = [sub ? `r/${sub.replace(/^\/?r\//, "")}` : "Reddit"];
      break;
    }
    case "pdf":
      parts = [str(meta.author), str(meta.arxiv) ? "arXiv" : hostOf(url)];
      break;
    case "hackernews":
      parts = [str(meta.author), "Hacker News"];
      break;
    case "bluesky":
      parts = [str(meta.author), "Bluesky"];
      break;
    case "note":
      parts = ["Note"];
      break;
    default:
      parts = [];
  }
  return {
    title: item.title.trim(),
    byline: parts.filter((p): p is string => !!p),
    url,
  };
}

function wholeSeconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
}

/** "0:47", "1:02:05". */
export function formatHighlightTime(seconds: number): string {
  const total = wholeSeconds(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

function youtubeVideoId(itemUrl: string | null | undefined): string | null {
  if (!itemUrl) return null;
  let u: URL;
  try {
    u = new URL(itemUrl);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id: string | null | undefined = null;
  if (host === "youtu.be") {
    id = u.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const m = /^\/(?:shorts|live|embed)\/([^/?#]+)/.exec(u.pathname);
    id = m ? m[1] : u.pathname === "/watch" ? u.searchParams.get("v") : null;
  }
  return id && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

/** `https://youtu.be/<id>?t=<seconds>`, or null when the URL is not a YouTube video. */
export function youtubeTimestampUrl(
  itemUrl: string | null | undefined,
  seconds: number,
): string | null {
  const id = youtubeVideoId(itemUrl);
  if (!id) return null;
  return `https://youtu.be/${id}?t=${wholeSeconds(seconds)}`;
}

function quoteLine(highlight: Pick<Highlight, "kind" | "quote" | "image_src">): string {
  const text = collapse(highlight.quote);
  if (highlight.kind === "image" && highlight.image_src) {
    return `![${text}](${highlight.image_src})`;
  }
  return `> ${text}`;
}

function describeSource(source: CopySource): string {
  return [source.title, ...source.byline].filter((p) => p).join(", ");
}

export function formatQuoteWithSource(highlight: Highlight, source: CopySource): string {
  let who = describeSource(source);
  let url = source.url;
  if (highlight.seconds !== null && highlight.seconds !== undefined) {
    who += `, at ${formatHighlightTime(highlight.seconds)}`;
    url = youtubeTimestampUrl(source.url, highlight.seconds) ?? url;
  }
  const attribution = `— ${who}.` + (url ? ` ${url}` : "");
  return `${quoteLine(highlight)}\n\n${attribution}`;
}

export function formatQuotesWithSources(
  entries: { highlight: Highlight; source: CopySource; itemId: string }[],
): string {
  if (entries.length === 0) return "";
  const numbers = new Map<string, number>();
  const sources: CopySource[] = [];
  const blocks: string[] = [];
  for (const { highlight, source, itemId } of entries) {
    let n = numbers.get(itemId);
    if (n === undefined) {
      n = sources.length + 1;
      numbers.set(itemId, n);
      sources.push(source);
    }
    const label =
      highlight.seconds !== null && highlight.seconds !== undefined
        ? `${n}, ${formatHighlightTime(highlight.seconds)}`
        : String(n);
    blocks.push(`${quoteLine(highlight)} [${label}]`);
  }
  const lines = sources.map(
    (s, i) => `${i + 1}. ${describeSource(s)}.` + (s.url ? ` ${s.url}` : ""),
  );
  return `${blocks.join("\n\n")}\n\nSources\n${lines.join("\n")}`;
}

function citationLink(c: HighlightCitation): string {
  const domain = hostOf(c.url) ?? c.url;
  const target = /[\s()]/.test(c.url) ? `<${c.url}>` : c.url;
  return `[${domain}](${target})`;
}

function compareHighlights(a: FileHighlight, b: FileHighlight): number {
  if (a.start_offset !== b.start_offset) return a.start_offset - b.start_offset;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** The `## My highlights` section of a file, or "" when there are none. No trailing newline. */
export function buildHighlightsSection(
  highlights: readonly FileHighlight[] | null | undefined,
  itemUrl: string | null | undefined,
): string {
  if (!highlights || highlights.length === 0) return "";
  const blocks = [...highlights].sort(compareHighlights).map((h) => {
    const parts: string[] = [];
    if (h.seconds !== null && h.seconds !== undefined) {
      const time = formatHighlightTime(h.seconds);
      const url = youtubeTimestampUrl(itemUrl, h.seconds);
      parts.push(url ? `[${time}](${url})` : time);
    }
    if (h.cited && h.cited.length > 0) {
      parts.push(`Cited: ${h.cited.map(citationLink).join(", ")}`);
    }
    const note = h.note ? collapse(h.note) : "";
    if (note) parts.push(`Note: ${note}`);
    const block = quoteLine(h);
    return parts.length > 0 ? `${block}\n\n${parts.join(" · ")}` : block;
  });
  return `## My highlights\n\n${blocks.join("\n\n")}`;
}
