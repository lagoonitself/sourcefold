// Fetches one Hacker News item with the official Algolia API. The API sends CORS headers, so
// this works from the web server, the desktop app and the extension alike.

import type { SourceExtractResult } from "../capture-types";
import type { SourceFetch, SourceFetchResponse } from "../source-fetch";
import { SourceError } from "../source-fetch";
import { parseHackerNewsLink } from "../source-links";
import {
  hackerNewsMeta,
  hackerNewsTitle,
  parseHackerNewsItem,
  renderHackerNewsMarkdown,
} from "./parse";

export interface HackerNewsFetchOptions {
  fetch: SourceFetch;
  signal?: AbortSignal;
}

export function hackerNewsApiUrl(itemId: string): string {
  return `https://hn.algolia.com/api/v1/items/${itemId}`;
}

function checkStatus(response: SourceFetchResponse): void {
  const { status } = response;
  if (status < 400) return;
  if (status === 404) throw new SourceError("not_found", "That Hacker News item doesn't exist.");
  if (status === 403 || status === 429) {
    throw new SourceError("blocked", "Hacker News blocked this request. Try again in a minute.");
  }
  if (status >= 500) {
    throw new SourceError(
      "fetch_failed",
      "Couldn't reach Hacker News. Check the link and try again.",
    );
  }
  throw new SourceError("blocked", "Hacker News blocked this request. Try again in a minute.");
}

/** Fetches one item and its comments as a capture. */
export async function fetchHackerNewsCapture(
  url: string,
  options: HackerNewsFetchOptions,
): Promise<SourceExtractResult> {
  const link = parseHackerNewsLink(url);
  if (!link) throw new SourceError("invalid_url", "That isn't a Hacker News item link.");

  let response: SourceFetchResponse;
  try {
    response = await options.fetch({ url: hackerNewsApiUrl(link.itemId), signal: options.signal });
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(
      "fetch_failed",
      "Couldn't reach Hacker News. Check the link and try again.",
    );
  }
  checkStatus(response);

  let json: unknown;
  try {
    json = JSON.parse(response.text);
  } catch {
    throw new SourceError("parse_failed", "Couldn't read this Hacker News item.");
  }

  const item = parseHackerNewsItem(json);
  if (!item) throw new SourceError("parse_failed", "Couldn't read this Hacker News item.");

  return {
    status: "ok",
    kind: "hackernews",
    capture: {
      url: link.url,
      title: hackerNewsTitle(item),
      meta: hackerNewsMeta(item),
      markdown: renderHackerNewsMarkdown(item),
    },
  };
}
