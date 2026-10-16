// Fetches a Reddit post with Reddit's public `.json`, no library and no login.
// Reddit refuses many cloud addresses with a 403; the callers say to use the desktop app or
// the extension, which fetch from the reader's own connection.

import type { SourceExtractResult } from "../capture-types";
import type { SourceFetch, SourceFetchResponse } from "../source-fetch";
import { SourceError } from "../source-fetch";
import { parseRedditLink, redditPostUrl } from "../source-links";
import { parseRedditThread, redditMeta, renderRedditMarkdown } from "./parse";

export interface RedditFetchOptions {
  fetch: SourceFetch;
  signal?: AbortSignal;
}

/** Reddit's own browser pages ask for JSON with this header. */
const JSON_HEADERS = { Accept: "application/json" };

const BLOCKED_MESSAGE =
  "Reddit blocked this request. Save Reddit threads with the desktop app or the Sourcefold extension.";

function checkStatus(response: SourceFetchResponse): void {
  const { status } = response;
  // Redirect responses pass through: the caller reads the final address from `url` or `location`.
  if (status < 400) return;
  if (status === 403) throw new SourceError("blocked", BLOCKED_MESSAGE);
  if (status === 429) {
    throw new SourceError(
      "blocked",
      "Reddit is limiting requests right now. Try again in a minute.",
    );
  }
  if (status === 404) throw new SourceError("not_found", "That Reddit post doesn't exist.");
  if (status >= 500) {
    throw new SourceError("fetch_failed", "Couldn't reach Reddit. Check the link and try again.");
  }
  throw new SourceError("blocked", BLOCKED_MESSAGE);
}

async function request(
  fetcher: SourceFetch,
  url: string,
  signal: AbortSignal | undefined,
): Promise<SourceFetchResponse> {
  try {
    return await fetcher({ url, headers: JSON_HEADERS, signal });
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError("fetch_failed", "Couldn't reach Reddit. Check the link and try again.");
  }
}

/** A `reddit.com/r/<sub>/s/<code>` share link only names its post after the redirect. */
async function resolveShareLink(
  fetcher: SourceFetch,
  shareUrl: string,
  signal: AbortSignal | undefined,
): Promise<{ postId: string; subreddit: string | null }> {
  const response = await request(fetcher, shareUrl, signal);
  checkStatus(response);

  const location = response.url || response.headers["location"] || "";
  const target = parseRedditLink(location);
  if (!target || target.type !== "post") {
    throw new SourceError("not_found", "That Reddit post doesn't exist.");
  }
  return { postId: target.postId, subreddit: target.subreddit };
}

function jsonUrl(postId: string, subreddit: string | null): string {
  const path = subreddit
    ? `https://www.reddit.com/r/${subreddit}/comments/${postId}.json`
    : `https://www.reddit.com/comments/${postId}.json`;
  return `${path}?raw_json=1&limit=500&sort=top`;
}

/**
 * Fetches one Reddit post and its comments as a capture. `raw_json=1` keeps text unescaped, so
 * the post's Markdown (and the comment bodies) need no entity decoding.
 */
export async function fetchRedditCapture(
  url: string,
  options: RedditFetchOptions,
): Promise<SourceExtractResult> {
  const link = parseRedditLink(url);
  if (!link) throw new SourceError("invalid_url", "That isn't a Reddit post link.");

  const target =
    link.type === "post"
      ? { postId: link.postId, subreddit: link.subreddit }
      : await resolveShareLink(options.fetch, link.url, options.signal);

  const response = await request(
    options.fetch,
    jsonUrl(target.postId, target.subreddit),
    options.signal,
  );
  checkStatus(response);

  let json: unknown;
  try {
    json = JSON.parse(response.text);
  } catch {
    throw new SourceError("parse_failed", "Couldn't read this Reddit thread.");
  }

  if (json !== null && typeof json === "object" && !Array.isArray(json)) {
    // A removed post answers 200 with `{"error": 404, "message": "Not Found"}`.
    throw new SourceError("not_found", "That Reddit post doesn't exist.");
  }

  const thread = parseRedditThread(json);
  if (!thread) {
    if (Array.isArray(json) && json.length > 0) {
      throw new SourceError("not_found", "That Reddit post doesn't exist.");
    }
    throw new SourceError("parse_failed", "Couldn't read this Reddit thread.");
  }

  const subreddit = thread.subreddit ?? target.subreddit;
  const canonical = subreddit ? { ...thread, subreddit } : thread;

  return {
    status: "ok",
    kind: "reddit",
    capture: {
      url: redditPostUrl(target.postId, subreddit),
      title: canonical.title,
      meta: redditMeta(canonical),
      markdown: renderRedditMarkdown(canonical),
    },
  };
}
