// The one way extractors for the 2026-10-16 source kinds (YouTube, web pages, Reddit, PDFs,
// Hacker News, Bluesky) reach the network. Each app passes its own implementation:
// - web server: `sourceFetchFromGlobalFetch()` (Node's fetch),
// - desktop: the Rust `web_fetch` command (no CORS, the user's own connection),
// - extension: the page's own `fetch` (same-origin requests on youtube.com, reddit.com).
// Extractors never call the global `fetch` themselves, so tests feed them saved fixtures.

export interface SourceFetchRequest {
  url: string;
  /** Defaults to `GET`. */
  method?: "GET" | "POST";
  /** Header names are case-insensitive. Browsers silently drop `User-Agent` and `Cookie`. */
  headers?: Record<string, string>;
  /** Request body for `POST`, already serialized (usually JSON). */
  body?: string;
  /** `bytes` for binary files (PDFs); the default `text` decodes the body as UTF-8. */
  responseType?: "text" | "bytes";
  signal?: AbortSignal;
}

export interface SourceFetchResponse {
  status: number;
  /** Final address after redirects. */
  url: string;
  /** Response headers with lowercase names. */
  headers: Record<string, string>;
  /** The body as text. Empty when `responseType` was `bytes`. */
  text: string;
  /** The raw body, only when `responseType` was `bytes`. */
  bytes?: Uint8Array;
}

export type SourceFetch = (request: SourceFetchRequest) => Promise<SourceFetchResponse>;

/** Error codes an extractor may throw. The message is shown to the user as is. */
export type SourceErrorCode =
  | "invalid_url" // not a link this extractor handles
  | "not_found" // 404, deleted post, private video
  | "blocked" // the site refused this connection (403, 429, a login wall, a bot check)
  | "fetch_failed" // network error or 5xx
  | "parse_failed" // got a page but couldn't find the content in it
  | "too_large"; // over the size limit

export class SourceError extends Error {
  readonly code: SourceErrorCode;

  constructor(code: SourceErrorCode, message: string) {
    super(message);
    this.name = "SourceError";
    this.code = code;
  }
}

/** Builds a `SourceFetch` on top of a WHATWG `fetch` (Node 18+, browsers, workers). */
export function sourceFetchFromGlobalFetch(
  fetchImpl: typeof fetch = fetch,
  defaultHeaders: Record<string, string> = {},
): SourceFetch {
  return async (request) => {
    const res = await fetchImpl(request.url, {
      method: request.method ?? "GET",
      headers: { ...defaultHeaders, ...request.headers },
      body: request.body,
      redirect: "follow",
      signal: request.signal,
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    if (request.responseType === "bytes") {
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { status: res.status, url: res.url || request.url, headers, text: "", bytes };
    }
    return { status: res.status, url: res.url || request.url, headers, text: await res.text() };
  };
}
