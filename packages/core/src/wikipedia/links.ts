// Recognizing Wikipedia article links. Any language edition counts; only main-namespace articles
// do (not Talk:, File:, Category:, Special: and the like).

export interface WikipediaArticleRef {
  /** Language edition code from the host, for example `en`, `de`, `zh-yue`. */
  language: string;
  /** Page title with underscores instead of spaces, decoded (`Rubik's_Cube`, `Café`). */
  title: string;
  /** Canonical address: `https://<language>.wikipedia.org/wiki/<Title>`. */
  url: string;
}

const HOST_PATTERN = /^([a-z][a-z0-9-]*)\.(?:m\.)?wikipedia\.org$/;

// Subdomains of wikipedia.org that are not language editions.
const NOT_LANGUAGES = new Set([
  "www",
  "m",
  "commons",
  "meta",
  "species",
  "login",
  "api",
  "test",
  "test2",
  "upload",
  "foundation",
  "donate",
]);

// English namespace names and their usual aliases, lowercased with spaces. Other languages name
// their namespaces differently; the API tells those apart (see fetchWikipediaCapture).
const NAMESPACES = new Set([
  "media",
  "special",
  "talk",
  "user",
  "user talk",
  "wikipedia",
  "wikipedia talk",
  "project",
  "project talk",
  "wp",
  "wt",
  "file",
  "file talk",
  "image",
  "image talk",
  "mediawiki",
  "mediawiki talk",
  "template",
  "template talk",
  "help",
  "help talk",
  "category",
  "category talk",
  "portal",
  "portal talk",
  "draft",
  "draft talk",
  "module",
  "module talk",
  "timedtext",
  "timedtext talk",
  "book",
  "book talk",
  "topic",
  "gadget",
  "gadget talk",
  "gadget definition",
  "gadget definition talk",
  "education program",
  "education program talk",
]);

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isWikipediaNamespaceTitle(title: string): boolean {
  const match = /^:?([^:]+):/.exec(title);
  if (!match || !match[1]) return false;
  return NAMESPACES.has(match[1].replace(/_/g, " ").trim().toLowerCase());
}

/** The page title as MediaWiki writes it in addresses: underscores, no stray ones at the ends. */
function normalizeTitle(raw: string): string {
  return raw.replace(/[\s_]+/g, "_").replace(/^_+|_+$/g, "");
}

function encodeTitle(title: string): string {
  return (
    encodeURIComponent(title)
      // Wikipedia leaves these readable in its own addresses.
      .replace(/%3A/gi, ":")
      .replace(/%2C/gi, ",")
      // Parentheses would end a Markdown link early.
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
  );
}

export function wikipediaArticleUrl(language: string, title: string): string {
  return `https://${language}.wikipedia.org/wiki/${encodeTitle(normalizeTitle(title))}`;
}

/** Whether the host is a Wikipedia language edition (article or not). */
export function isWikipediaHost(hostname: string): boolean {
  const match = HOST_PATTERN.exec(hostname.toLowerCase());
  return Boolean(match && match[1] && !NOT_LANGUAGES.has(match[1]));
}

/**
 * Reads a Wikipedia article link in any of its forms: `/wiki/Title`, the mobile host,
 * `index.php?title=Title`. The `#section` and other query parameters are dropped. Returns null
 * for anything that isn't a main-namespace article.
 */
export function parseWikipediaUrl(input: string): WikipediaArticleRef | null {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const hostMatch = HOST_PATTERN.exec(parsed.hostname.toLowerCase());
  const language = hostMatch?.[1];
  if (!language || NOT_LANGUAGES.has(language)) return null;

  let rawTitle: string | null = null;
  const path = parsed.pathname;
  if (path === "/w/index.php" || path === "/index.php" || path === "/wiki/index.php") {
    rawTitle = parsed.searchParams.get("title");
  } else if (path.startsWith("/wiki/")) {
    rawTitle = safeDecode(path.slice("/wiki/".length));
  }
  if (!rawTitle) return null;

  const title = normalizeTitle(rawTitle);
  if (!title || title.length > 255) return null;
  if (isWikipediaNamespaceTitle(title)) return null;

  return { language, title, url: wikipediaArticleUrl(language, title) };
}

export function isWikipediaArticleUrl(input: string): boolean {
  return parseWikipediaUrl(input) !== null;
}

/** The address a pasted Wikipedia link should be saved under, or null if it isn't an article. */
export function canonicalWikipediaUrl(input: string): string | null {
  return parseWikipediaUrl(input)?.url ?? null;
}

/** Wikimedia REST API addresses for an article. Both follow redirects and send CORS headers. */
export function wikipediaApiUrls(ref: Pick<WikipediaArticleRef, "language" | "title">): {
  html: string;
  summary: string;
} {
  const title = encodeURIComponent(ref.title);
  const base = `https://${ref.language}.wikipedia.org/api/rest_v1/page`;
  return { html: `${base}/html/${title}`, summary: `${base}/summary/${title}` };
}
