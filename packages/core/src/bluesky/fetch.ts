// Fetches one Bluesky post and its replies with the public AppView API (public.api.bsky.app,
// no login). The API sends CORS headers, so this works from the web server, the desktop app and
// the extension alike.

import type { SourceExtractResult } from "../capture-types";
import type { SourceFetch, SourceFetchResponse } from "../source-fetch";
import { SourceError } from "../source-fetch";
import { blueskyPostUrl, parseBlueskyLink } from "../source-links";
import { blueskyMeta, blueskyTitle, parseBlueskyThread, renderBlueskyMarkdown } from "./parse";

export interface BlueskyFetchOptions {
  fetch: SourceFetch;
  signal?: AbortSignal;
}

const API = "https://public.api.bsky.app/xrpc";

export function blueskyResolveHandleUrl(handle: string): string {
  return `${API}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`;
}

export function blueskyThreadUrl(did: string, rkey: string): string {
  const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
  return `${API}/app.bsky.feed.getPostThread?uri=${uri}&depth=6&parentHeight=0`;
}

async function getJson(options: BlueskyFetchOptions, url: string): Promise<unknown> {
  let response: SourceFetchResponse;
  try {
    response = await options.fetch({ url, signal: options.signal });
  } catch {
    throw new SourceError("fetch_failed", "Couldn't reach Bluesky. Check the link and try again.");
  }
  const { status } = response;
  // The API answers 400 for a handle or post that doesn't exist.
  if (status === 400 || status === 404) {
    throw new SourceError("not_found", "That Bluesky post doesn't exist or was deleted.");
  }
  if (status >= 500) {
    throw new SourceError("fetch_failed", "Couldn't reach Bluesky. Check the link and try again.");
  }
  if (status >= 400) {
    throw new SourceError("blocked", "Bluesky blocked this request. Try again in a minute.");
  }
  try {
    return JSON.parse(response.text);
  } catch {
    throw new SourceError("parse_failed", "Couldn't read this Bluesky post.");
  }
}

/** Fetches one post, the author's own replies and other people's replies as a capture. */
export async function fetchBlueskyCapture(
  url: string,
  options: BlueskyFetchOptions,
): Promise<SourceExtractResult> {
  const link = parseBlueskyLink(url);
  if (!link) throw new SourceError("invalid_url", "That isn't a Bluesky post link.");

  let did = link.actor;
  if (!did.startsWith("did:")) {
    const resolvedJson = await getJson(options, blueskyResolveHandleUrl(did));
    const resolved = (resolvedJson as { did?: unknown } | null)?.did;
    if (typeof resolved !== "string" || !resolved.startsWith("did:")) {
      throw new SourceError("parse_failed", "Couldn't read this Bluesky post.");
    }
    did = resolved;
  }

  const json = await getJson(options, blueskyThreadUrl(did, link.rkey));
  const thread = parseBlueskyThread(json);
  if (thread === "missing") {
    throw new SourceError("not_found", "That Bluesky post doesn't exist or was deleted.");
  }
  if (!thread) throw new SourceError("parse_failed", "Couldn't read this Bluesky post.");

  return {
    status: "ok",
    kind: "bluesky",
    capture: {
      url: blueskyPostUrl(thread.root.handle, link.rkey),
      title: blueskyTitle(thread),
      meta: blueskyMeta(thread),
      markdown: renderBlueskyMarkdown(thread),
    },
  };
}
