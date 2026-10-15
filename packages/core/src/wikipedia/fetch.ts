import type { WikipediaCapture } from "../capture-types";
import { wikipediaToMarkdown } from "./convert";
import { parseWikipediaUrl, wikipediaApiUrls, wikipediaArticleUrl, isWikipediaHost } from "./links";

// Fetches an article from Wikimedia's REST API and turns it into a capture. The API sends CORS
// headers, so this runs in a browser or webview as well as on the server.

export type WikipediaErrorCode =
  "invalid_url" | "not_article" | "disambiguation" | "not_found" | "fetch_failed" | "parse_failed";

export const WIKIPEDIA_ERROR_MESSAGES = {
  invalid_url: "That isn't a Wikipedia article link.",
  not_article:
    "That isn't a Wikipedia article. Only articles can be saved, not talk or file pages.",
  disambiguation: "That page lists several meanings. Open the one you want and add its link.",
  not_found: "That Wikipedia article doesn't exist.",
  fetch_failed: "Couldn't reach Wikipedia. Check the link and try again.",
  parse_failed: "Couldn't read this Wikipedia article.",
} as const satisfies Record<WikipediaErrorCode, string>;

export class WikipediaError extends Error {
  readonly code: WikipediaErrorCode;

  constructor(code: WikipediaErrorCode, message?: string) {
    super(message ?? WIKIPEDIA_ERROR_MESSAGES[code]);
    this.name = "WikipediaError";
    this.code = code;
  }
}

/** Wikimedia asks API clients to say who they are. Browsers can only set `Api-User-Agent`. */
export const WIKIPEDIA_USER_AGENT =
  "Sourcefold/0.1 (https://github.com/lagoonitself/sourcefold; research source collector)";

export interface WikipediaFetchOptions {
  /** Parses an HTML string: linkedom's `parseHTML(html).document`, or a `DOMParser`. */
  parseHtml: (html: string) => Document;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Extra request headers, for example `User-Agent` on the server (browsers can't set it). */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

interface SummaryResponse {
  type?: string;
  namespace?: { id?: number };
  titles?: { canonical?: string; normalized?: string };
  title?: string;
  lang?: string;
  description?: string;
  revision?: string;
  timestamp?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readSummary(response: Response | null): Promise<SummaryResponse | null> {
  if (!response || !response.ok) return null;
  try {
    const json: unknown = await response.json();
    return isRecord(json) ? (json as SummaryResponse) : null;
  } catch {
    return null;
  }
}

function metaContent(doc: Document, property: string): string | null {
  const content = doc.querySelector(`meta[property="${property}"]`)?.getAttribute("content");
  return content && content.trim() ? content.trim() : null;
}

function titleFromHtml(doc: Document): string | null {
  const title = doc.querySelector("title")?.textContent;
  return title && title.trim() ? title.trim() : null;
}

function canonicalTitleFromHtml(doc: Document): string | null {
  const href = doc.querySelector('link[rel="dc:isVersionOf"]')?.getAttribute("href");
  const raw = href?.split("/wiki/")[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Fetches one article by any of its links and converts it. Redirects are followed, so the capture's
 * `url` and `title` are those of the page the link led to.
 */
export async function fetchWikipediaCapture(
  input: string,
  options: WikipediaFetchOptions,
): Promise<WikipediaCapture> {
  const ref = parseWikipediaUrl(input);
  if (!ref) {
    let host = "";
    try {
      host = new URL(input.trim()).hostname;
    } catch {
      // Not a URL at all.
    }
    throw new WikipediaError(isWikipediaHost(host) ? "not_article" : "invalid_url");
  }

  const doFetch = options.fetch ?? fetch;
  const init: RequestInit = {
    headers: { "Api-User-Agent": WIKIPEDIA_USER_AGENT, ...options.headers },
    redirect: "follow",
    signal: options.signal,
  };
  const urls = wikipediaApiUrls(ref);

  let htmlResponse: Response;
  let summaryResponse: Response | null;
  try {
    [htmlResponse, summaryResponse] = await Promise.all([
      doFetch(urls.html, init),
      doFetch(urls.summary, init).catch(() => null),
    ]);
  } catch {
    throw new WikipediaError("fetch_failed");
  }

  if (htmlResponse.status === 404) throw new WikipediaError("not_found");
  if (!htmlResponse.ok) throw new WikipediaError("fetch_failed");

  let html: string;
  try {
    html = await htmlResponse.text();
  } catch {
    throw new WikipediaError("fetch_failed");
  }

  const summary = await readSummary(summaryResponse);
  if (summary?.type === "disambiguation") throw new WikipediaError("disambiguation");
  if (summary?.namespace?.id !== undefined && summary.namespace.id !== 0) {
    throw new WikipediaError("not_article");
  }

  let doc: Document;
  try {
    doc = options.parseHtml(html);
  } catch {
    throw new WikipediaError("parse_failed");
  }

  const namespace = metaContent(doc, "mw:pageNamespace");
  if (namespace !== null && namespace !== "0") throw new WikipediaError("not_article");

  // The revision the text came from is named in the page itself; the summary is a fallback.
  const about = doc.documentElement?.getAttribute("about") ?? "";
  const revision = /revision\/(\d+)/.exec(about)?.[1] ?? summary?.revision ?? null;
  const lastEdited = metaContent(doc, "dc:modified") ?? summary?.timestamp ?? null;

  const canonicalTitle = summary?.titles?.canonical ?? canonicalTitleFromHtml(doc) ?? ref.title;
  const title = (
    summary?.titles?.normalized ??
    summary?.title ??
    titleFromHtml(doc) ??
    canonicalTitle.replace(/_/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
  const language = summary?.lang?.trim() || ref.language;

  const markdown = wikipediaToMarkdown(doc, { language: ref.language });
  if (!markdown.trim()) throw new WikipediaError("parse_failed");

  const description = summary?.description?.trim();
  return {
    url: wikipediaArticleUrl(ref.language, canonicalTitle),
    title: title.slice(0, 500) || ref.title.replace(/_/g, " "),
    summary: description ? description : null,
    language,
    revision,
    lastEdited,
    markdown,
  };
}
