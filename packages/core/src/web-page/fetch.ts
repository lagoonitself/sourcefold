import type { SourceExtractResult } from "../capture-types";
import { SourceError, type SourceFetch, type SourceFetchResponse } from "../source-fetch";
import { isBotWall } from "./bot-wall";
import { MIN_WEB_PAGE_TEXT_LENGTH, webPageTextLength, webPageToCapture } from "./convert";

// Fetches any http(s) page and turns it into a `web` capture through defuddle (see ./convert).
// The caller supplies the network layer (`SourceFetch`) and the HTML parser, so this runs on the
// server (linkedom), in the desktop webview and in the extension (DOMParser).

/** The server refuses to hand a body larger than this to the parser. */
export const MAX_WEB_PAGE_BYTES = 10 * 1024 * 1024;

const ACCEPT_HEADER = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

const MESSAGES = {
  not_found: "This page doesn't exist anymore.",
  blocked:
    "The site refused the request. Try saving it with the Sourcefold extension while you have the page open.",
  fetch_failed: "Couldn't reach that page. Check the link and try again.",
  too_large: "This page is too large to save.",
  not_a_page: "This link isn't a web page Sourcefold can read.",
  no_content: "Couldn't find the article text on this page.",
} as const;

/**
 * Thrown when the link turns out to be a PDF, so a dispatcher can hand it to the PDF extractor.
 * `url` is the final address after redirects.
 */
export class WebPageIsPdfError extends SourceError {
  readonly url: string;

  constructor(url: string) {
    super("invalid_url", "This link is a PDF, not a web page.");
    this.name = "WebPageIsPdfError";
    this.url = url;
  }
}

export interface WebPageFetchOptions {
  /** Network layer: the server's fetch, the desktop's `web_fetch` or the extension's `fetch`. */
  fetch: SourceFetch;
  /** Parses an HTML string: linkedom's `parseHTML(html).document`, or a `DOMParser`. */
  parseHtml: (html: string) => Document;
  signal?: AbortSignal;
}

function throwIfBadStatus(status: number): void {
  if (status >= 200 && status < 300) return;
  if (status === 404 || status === 410) {
    throw new SourceError("not_found", MESSAGES.not_found);
  }
  if (status === 401 || status === 403 || status === 407 || status === 429) {
    throw new SourceError("blocked", MESSAGES.blocked);
  }
  if (status >= 500 && status <= 599) {
    throw new SourceError(
      "fetch_failed",
      `The site answered with an error (HTTP ${status}). It may be down; try again later.`,
    );
  }
  throw new SourceError("fetch_failed", `The site answered HTTP ${status} instead of the page.`);
}

function isTooLarge(response: SourceFetchResponse): boolean {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_WEB_PAGE_BYTES) return true;
  if (response.bytes && response.bytes.byteLength > MAX_WEB_PAGE_BYTES) return true;
  return response.text.length > MAX_WEB_PAGE_BYTES;
}

function isPdf(contentType: string, body: string): boolean {
  return contentType.includes("application/pdf") || /^\s*%PDF-/.test(body);
}

function isHtmlContentType(contentType: string): boolean {
  return !contentType || contentType.includes("html");
}

/**
 * Fetches a page and converts it. The capture carries the final address after redirects.
 * A response that is a PDF throws `WebPageIsPdfError`; other non-HTML responses and pages with
 * no readable article text throw a `parse_failed` `SourceError`.
 */
export async function fetchWebPageCapture(
  url: string,
  options: WebPageFetchOptions,
): Promise<SourceExtractResult> {
  let response: SourceFetchResponse;
  try {
    response = await options.fetch({
      url,
      headers: { Accept: ACCEPT_HEADER },
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (error instanceof SourceError) throw error;
    throw new SourceError("fetch_failed", MESSAGES.fetch_failed);
  }

  throwIfBadStatus(response.status);

  if (isTooLarge(response)) {
    throw new SourceError("too_large", MESSAGES.too_large);
  }

  const finalUrl = response.url || url;
  const contentType = (response.headers["content-type"] ?? "").toLowerCase();

  if (isPdf(contentType, response.text)) {
    throw new WebPageIsPdfError(finalUrl);
  }
  if (!isHtmlContentType(contentType)) {
    throw new SourceError("parse_failed", MESSAGES.not_a_page);
  }

  if (isBotWall(response.text)) {
    throw new SourceError("blocked", MESSAGES.blocked);
  }

  const capture = (() => {
    try {
      return webPageToCapture(response.text, finalUrl, options.parseHtml);
    } catch {
      throw new SourceError("parse_failed", MESSAGES.no_content);
    }
  })();
  if (webPageTextLength(capture.markdown) < MIN_WEB_PAGE_TEXT_LENGTH) {
    throw new SourceError("parse_failed", MESSAGES.no_content);
  }

  return { status: "ok", kind: "web", capture };
}
