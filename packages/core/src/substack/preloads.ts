// Approach ported from sbstck-dl by Alex Ferrari (MIT), https://github.com/alexferrari88/sbstck-dl
// Every Substack page embeds its data as `window._preloads = JSON.parse("…")`. For a post page
// that includes the full post body (`post.body_html`) whenever the reader may see it.

export interface SubstackByline {
  name: string | null;
  handle: string | null;
}

export interface SubstackPreloadedPost {
  title: string;
  subtitle: string | null;
  bodyHtml: string;
  canonicalUrl: string | null;
  postDate: string | null;
  audience: string | null;
  type: string | null;
  bylines: SubstackByline[];
}

export interface SubstackPreloadedPublication {
  name: string | null;
  baseUrl: string | null;
}

export interface SubstackPreloads {
  post: SubstackPreloadedPost | null;
  pub: SubstackPreloadedPublication | null;
  canonicalUrl: string | null;
}

const MARKER = "window._preloads";
const PARSE_OPEN = 'JSON.parse("';

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Returns the decoded preloads object, or null when the text has none. Accepts a whole page or one script's text. */
export function readPreloadsJson(text: string): Record<string, unknown> | null {
  const markerAt = text.indexOf(MARKER);
  if (markerAt === -1) return null;
  const openAt = text.indexOf(PARSE_OPEN, markerAt);
  if (openAt === -1) return null;
  const start = openAt + PARSE_OPEN.length;

  // The argument is a JSON string literal: scan to its closing quote, skipping escapes.
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 92 /* \ */) {
      i++;
    } else if (ch === 34 /* " */) {
      end = i;
      break;
    }
  }
  if (end === -1) return null;

  try {
    const decoded: unknown = JSON.parse(`"${text.slice(start, end)}"`);
    if (typeof decoded !== "string") return null;
    return asRecord(JSON.parse(decoded));
  } catch {
    return null;
  }
}

function readPost(raw: Record<string, unknown> | null): SubstackPreloadedPost | null {
  if (!raw) return null;
  const title = asString(raw.title);
  if (!title) return null;

  const bylines: SubstackByline[] = [];
  if (Array.isArray(raw.publishedBylines)) {
    for (const entry of raw.publishedBylines) {
      const byline = asRecord(entry);
      if (!byline) continue;
      bylines.push({ name: asString(byline.name), handle: asString(byline.handle) });
    }
  }

  return {
    title,
    subtitle: asString(raw.subtitle),
    bodyHtml: typeof raw.body_html === "string" ? raw.body_html : "",
    canonicalUrl: asString(raw.canonical_url),
    postDate: asString(raw.post_date),
    audience: asString(raw.audience),
    type: asString(raw.type),
    bylines,
  };
}

export function parseSubstackPreloads(text: string): SubstackPreloads | null {
  const json = readPreloadsJson(text);
  if (!json) return null;
  const pub = asRecord(json.pub);
  return {
    post: readPost(asRecord(json.post)),
    pub: pub ? { name: asString(pub.name), baseUrl: asString(pub.base_url) } : null,
    canonicalUrl: asString(json.canonicalUrl),
  };
}

/** Finds the preloads in a parsed page (live tab or DOMParser output). */
export function findSubstackPreloads(doc: Document): SubstackPreloads | null {
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    const text = script.textContent;
    if (text && text.includes(MARKER)) {
      const parsed = parseSubstackPreloads(text);
      if (parsed) return parsed;
    }
  }
  return null;
}
