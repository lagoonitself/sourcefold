// Lists the videos of a YouTube playlist or channel, so Add links can show one row per video
// (like a Substack publication). Reads `ytInitialData` from the page, then follows its
// continuation tokens through InnerTube `browse` as the web client.

import { SourceError } from "../source-fetch";
import { parseYouTubeLink, youTubeVideoUrl } from "../source-links";
import {
  checkYouTubeStatus,
  extractJsonAfter,
  fetchYouTubePage,
  type YouTubeFetchOptions,
} from "./fetch";

export interface YouTubeListedVideo {
  videoId: string;
  url: string;
  title: string;
  /** `m:ss` or `h:mm:ss` as YouTube shows it, when known. */
  duration: string | null;
}

export interface YouTubeVideoList {
  /** The playlist's or channel's name. */
  title: string | null;
  videos: YouTubeListedVideo[];
  /** True when the list stopped at `limit` with more videos left. */
  truncated: boolean;
}

export interface YouTubeListOptions extends YouTubeFetchOptions {
  /** Most videos to return. Default 500. */
  limit?: number;
}

const DEFAULT_LIMIT = 500;
const FALLBACK_WEB_CLIENT_VERSION = "2.20261015.01.00";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string | null {
  if (!isObject(value)) return typeof value === "string" ? value : null;
  if (typeof value.content === "string") return value.content;
  if (typeof value.simpleText === "string") return value.simpleText;
  if (Array.isArray(value.runs)) {
    return value.runs
      .map((run) => (isObject(run) && typeof run.text === "string" ? run.text : ""))
      .join("");
  }
  return null;
}

/** The first string under `key` anywhere inside `value`. */
function findString(value: unknown, key: string, test?: (found: string) => boolean): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, key, test);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;
  for (const [name, child] of Object.entries(value)) {
    if (name === key && typeof child === "string" && (!test || test(child))) return child;
    const found = findString(child, key, test);
    if (found) return found;
  }
  return null;
}

const DURATION = /^\d{1,2}(:\d{2}){1,2}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

interface Collected {
  videos: YouTubeListedVideo[];
  seen: Set<string>;
  continuation: string | null;
}

function addVideo(
  into: Collected,
  videoId: unknown,
  title: string | null,
  duration: string | null,
) {
  if (typeof videoId !== "string" || !VIDEO_ID.test(videoId) || into.seen.has(videoId)) return;
  into.seen.add(videoId);
  into.videos.push({
    videoId,
    url: youTubeVideoUrl(videoId),
    title: title?.trim() || `YouTube video ${videoId}`,
    duration,
  });
}

/**
 * Walks page data for videos, in page order, and the continuation token for the next page.
 * Handles the current `lockupViewModel` items and the older `*VideoRenderer` ones; Shorts
 * shelves and other kinds of items are skipped.
 */
function collect(value: unknown, into: Collected): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into);
    return;
  }
  if (!isObject(value)) return;

  for (const [name, child] of Object.entries(value)) {
    if (!isObject(child)) continue;
    if (name === "lockupViewModel") {
      if (child.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
        const metadata = isObject(child.metadata) ? child.metadata.lockupMetadataViewModel : null;
        const title = isObject(metadata) ? text(metadata.title) : null;
        const duration = findString(child.contentImage, "text", (found) => DURATION.test(found));
        addVideo(into, child.contentId, title, duration);
      }
    } else if (
      name === "videoRenderer" ||
      name === "playlistVideoRenderer" ||
      name === "gridVideoRenderer"
    ) {
      const duration = text(child.lengthText);
      addVideo(
        into,
        child.videoId,
        text(child.title),
        duration && DURATION.test(duration) ? duration : null,
      );
    } else if (name === "continuationItemRenderer" || name === "continuationItemViewModel") {
      // The first token is the item list's own; a playlist reply also has a section-level one
      // that comes back empty.
      into.continuation ??= findString(child, "token");
    } else {
      collect(child, into);
    }
  }
}

function listTitle(data: Json): string | null {
  const metadata = isObject(data.metadata) ? data.metadata : {};
  for (const key of ["playlistMetadataRenderer", "channelMetadataRenderer"]) {
    const renderer = metadata[key];
    if (isObject(renderer) && typeof renderer.title === "string") return renderer.title;
  }
  return null;
}

/**
 * Lists a playlist's or channel's videos (newest first for channels, playlist order for
 * playlists), up to `limit`.
 */
export async function listYouTubeVideos(
  url: string,
  options: YouTubeListOptions,
): Promise<YouTubeVideoList> {
  const link = parseYouTubeLink(url);
  if (!link || link.type === "video") {
    throw new SourceError("invalid_url", "That isn't a YouTube playlist or channel link.");
  }
  const limit = options.limit ?? DEFAULT_LIMIT;
  const pageUrl = link.type === "channel" ? `${link.url}/videos` : link.url;

  const { html, cookie } = await fetchYouTubePage(pageUrl, options);
  const data = (extractJsonAfter(html, "var ytInitialData = ") ??
    extractJsonAfter(html, 'window["ytInitialData"] = ')) as Json | null;
  if (!data) {
    throw new SourceError("parse_failed", "Couldn't read the YouTube page. Try again in a minute.");
  }

  const collected: Collected = { videos: [], seen: new Set(), continuation: null };
  collect(data.contents, collected);

  const apiKey = html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/)?.[1];
  const clientVersion =
    html.match(/"INNERTUBE_CLIENT_VERSION":\s*"([0-9.]+)"/)?.[1] ?? FALLBACK_WEB_CLIENT_VERSION;

  // A playlist page's own continuation token comes back empty for signed-out requests, so
  // playlists are paged by asking `browse` for the playlist itself (the first 100 again, which
  // are skipped as duplicates) and following that reply's tokens.
  let nextRequest: Json | null =
    link.type === "playlist"
      ? { browseId: `VL${link.playlistId}` }
      : collected.continuation
        ? { continuation: collected.continuation }
        : null;
  const usedTokens = new Set<string>();

  while (apiKey && nextRequest && collected.videos.length < limit) {
    collected.continuation = null;
    const response = await options.fetch({
      url: `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion, hl: "en" } },
        ...nextRequest,
      }),
      signal: options.signal,
    });
    checkYouTubeStatus(response, "page");
    let next: Json;
    try {
      next = JSON.parse(response.text) as Json;
    } catch {
      break;
    }
    // A continuation reply can repeat the first page under `contents`; the new items and the next
    // token are in the actions, so those are read first.
    collect(
      [next.onResponseReceivedActions, next.onResponseReceivedEndpoints, next.contents],
      collected,
    );

    const token: string | null = collected.continuation;
    nextRequest = token && !usedTokens.has(token) ? { continuation: token } : null;
    if (token) usedTokens.add(token);
  }

  const truncated = collected.videos.length > limit || nextRequest !== null;
  return { title: listTitle(data), videos: collected.videos.slice(0, limit), truncated };
}
