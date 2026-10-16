// Recognizing links for the source kinds added on 2026-10-16, and their canonical addresses.
// `canonicalizeUrl` (./url) uses these, so duplicate checks treat every form of a link as one.
// The desktop's Rust `canonicalize_url` follows the same rules.

import type { SourceCaptureKind } from "./capture-types";

function parse(input: string): URL | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function bareHost(url: URL): string {
  const host = url.hostname.toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}

function trimmedPath(url: URL): string {
  return url.pathname.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------------------------
// YouTube

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/;

export type YouTubeLink =
  | { type: "video"; videoId: string; url: string }
  | { type: "playlist"; playlistId: string; url: string }
  | { type: "channel"; url: string };

/**
 * Reads a YouTube link. Videos: `watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`, `/v/`,
 * on www, m., music. and nocookie hosts; timestamps and other parameters are dropped
 * (`watch?v=X&list=Y` is the video). Playlists: `playlist?list=`. Channels: `/@handle`,
 * `/channel/UC…`, `/c/name`, `/user/name`, with or without a tab like `/videos`.
 */
export function parseYouTubeLink(input: string): YouTubeLink | null {
  const url = parse(input);
  if (!url) return null;
  const host = bareHost(url);
  const path = trimmedPath(url);

  if (host === "youtu.be") {
    const id = path.split("/")[1] ?? "";
    return VIDEO_ID.test(id) ? video(id) : null;
  }
  if (!YOUTUBE_HOSTS.has(host)) return null;

  if (path === "/watch") {
    const id = url.searchParams.get("v") ?? "";
    return VIDEO_ID.test(id) ? video(id) : null;
  }
  const embedded = path.match(/^\/(?:shorts|live|embed|v|e)\/([^/]+)$/);
  if (embedded) {
    return VIDEO_ID.test(embedded[1]!) ? video(embedded[1]!) : null;
  }
  if (path === "/playlist") {
    const list = url.searchParams.get("list") ?? "";
    return PLAYLIST_ID.test(list)
      ? { type: "playlist", playlistId: list, url: `https://www.youtube.com/playlist?list=${list}` }
      : null;
  }
  const handle = path.match(/^\/(@[^/]+)(?:\/(?:videos|shorts|streams|featured|playlists))?$/);
  if (handle) {
    return { type: "channel", url: `https://www.youtube.com/${handle[1]!.toLowerCase()}` };
  }
  const named = path.match(
    /^\/(channel|c|user)\/([^/]+)(?:\/(?:videos|shorts|streams|featured|playlists))?$/,
  );
  if (named) {
    return { type: "channel", url: `https://www.youtube.com/${named[1]}/${named[2]}` };
  }
  return null;
}

function video(videoId: string): YouTubeLink {
  return { type: "video", videoId, url: youTubeVideoUrl(videoId) };
}

/** Canonical video address: `https://www.youtube.com/watch?v=<id>`. */
export function youTubeVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Timestamp link used in transcripts: `https://youtu.be/<id>?t=<seconds>`. */
export function youTubeTimestampUrl(videoId: string, seconds: number): string {
  return `https://youtu.be/${videoId}?t=${Math.max(0, Math.floor(seconds))}`;
}

// ---------------------------------------------------------------------------------------------
// Reddit

const REDDIT_HOSTS = new Set([
  "reddit.com",
  "old.reddit.com",
  "new.reddit.com",
  "np.reddit.com",
  "m.reddit.com",
  "i.reddit.com",
]);

export type RedditLink =
  // A post. `subreddit` is lowercase, or null for `/comments/<id>` and `redd.it/<id>` links.
  | { type: "post"; postId: string; subreddit: string | null; url: string }
  // `reddit.com/r/<sub>/s/<code>` share links: only a request (following the redirect) tells
  // which post they are.
  | { type: "share"; url: string };

/**
 * Reads a Reddit post link: `/r/<sub>/comments/<id>/<slug>/[<comment id>]`, `/comments/<id>`,
 * `redd.it/<id>`, on www, old., new., np. and m. hosts. Canonical form:
 * `https://www.reddit.com/r/<sub>/comments/<id>` (or `https://www.reddit.com/comments/<id>`
 * when the link doesn't name the subreddit).
 */
export function parseRedditLink(input: string): RedditLink | null {
  const url = parse(input);
  if (!url) return null;
  const host = bareHost(url);
  const path = trimmedPath(url);

  if (host === "redd.it") {
    const id = path.split("/")[1]?.toLowerCase() ?? "";
    return /^[a-z0-9]{3,12}$/.test(id) ? redditPost(id, null) : null;
  }
  if (!REDDIT_HOSTS.has(host)) return null;

  const inSub = path.match(/^\/r\/([A-Za-z0-9_]{2,32})\/comments\/([A-Za-z0-9]{3,12})(?:\/.*)?$/);
  if (inSub) return redditPost(inSub[2]!.toLowerCase(), inSub[1]!.toLowerCase());
  const bare = path.match(/^\/comments\/([A-Za-z0-9]{3,12})(?:\/.*)?$/);
  if (bare) return redditPost(bare[1]!.toLowerCase(), null);
  const share = path.match(/^\/r\/([A-Za-z0-9_]{2,32})\/s\/([A-Za-z0-9]+)$/);
  if (share) return { type: "share", url: `https://www.reddit.com${path}` };
  return null;
}

function redditPost(postId: string, subreddit: string | null): RedditLink {
  return { type: "post", postId, subreddit, url: redditPostUrl(postId, subreddit) };
}

export function redditPostUrl(postId: string, subreddit: string | null): string {
  return subreddit
    ? `https://www.reddit.com/r/${subreddit}/comments/${postId}`
    : `https://www.reddit.com/comments/${postId}`;
}

// ---------------------------------------------------------------------------------------------
// Hacker News

/** Reads `news.ycombinator.com/item?id=<n>`. Canonical form keeps only the id. */
export function parseHackerNewsLink(input: string): { itemId: string; url: string } | null {
  const url = parse(input);
  if (!url || bareHost(url) !== "news.ycombinator.com" || trimmedPath(url) !== "/item") {
    return null;
  }
  const id = url.searchParams.get("id") ?? "";
  if (!/^\d{1,12}$/.test(id)) return null;
  return { itemId: id, url: hackerNewsItemUrl(id) };
}

export function hackerNewsItemUrl(itemId: string): string {
  return `https://news.ycombinator.com/item?id=${itemId}`;
}

// ---------------------------------------------------------------------------------------------
// Bluesky

/**
 * Reads `bsky.app/profile/<handle or did>/post/<rkey>`. Handles are lowercased; DIDs are kept
 * as written.
 */
export function parseBlueskyLink(
  input: string,
): { actor: string; rkey: string; url: string } | null {
  const url = parse(input);
  if (!url || bareHost(url) !== "bsky.app") return null;
  const match = trimmedPath(url).match(/^\/profile\/([^/]+)\/post\/([A-Za-z0-9]{2,32})$/);
  if (!match) return null;
  let actor = decodeURIComponent(match[1]!);
  if (!actor.startsWith("did:")) actor = actor.toLowerCase();
  const rkey = match[2]!;
  return { actor, rkey, url: blueskyPostUrl(actor, rkey) };
}

export function blueskyPostUrl(actor: string, rkey: string): string {
  return `https://bsky.app/profile/${actor}/post/${rkey}`;
}

// ---------------------------------------------------------------------------------------------
// arXiv and PDFs

const ARXIV_NEW_ID = /^(\d{4}\.\d{4,5})(v\d+)?$/;
const ARXIV_OLD_ID = /^([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?$/;

/**
 * Reads an arXiv paper link: `/abs/<id>`, `/pdf/<id>[.pdf]`, `/html/<id>`, on arxiv.org and
 * export.arxiv.org, new (`2401.01234v2`) and old (`hep-th/9901001`) ids. `id` has no version;
 * `version` is `v2` or null. Canonical form: `https://arxiv.org/abs/<id>`.
 */
export function parseArxivLink(
  input: string,
): { id: string; version: string | null; url: string } | null {
  const url = parse(input);
  if (!url) return null;
  const host = bareHost(url);
  if (host !== "arxiv.org" && host !== "export.arxiv.org") return null;
  const match = trimmedPath(url).match(/^\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?$/);
  if (!match) return null;
  const raw = decodeURIComponent(match[1]!);
  const parts = raw.match(ARXIV_NEW_ID) ?? raw.match(ARXIV_OLD_ID);
  if (!parts) return null;
  return { id: parts[1]!, version: parts[2] ?? null, url: `https://arxiv.org/abs/${parts[1]}` };
}

/** A link whose path ends in `.pdf`. Other PDFs are only known from the response type. */
export function looksLikePdfUrl(input: string): boolean {
  const url = parse(input);
  return url !== null && /\.pdf$/i.test(trimmedPath(url));
}

// ---------------------------------------------------------------------------------------------
// Routing

/**
 * Which 2026-10-16 source kind a pasted link is, before any request: `youtube`, `reddit`,
 * `hackernews`, `bluesky`, `pdf` (arXiv or a `.pdf` path) or `web` for any other http(s) link.
 * Callers check the older kinds (Grokipedia, Wikipedia, Substack, X) first. YouTube playlists
 * and channels count as `youtube` (`parseYouTubeLink` tells them apart). Null for anything that
 * isn't an http(s) link.
 */
export function detectLinkKind(input: string): SourceCaptureKind | null {
  if (!parse(input)) return null;
  if (parseYouTubeLink(input)) return "youtube";
  if (parseRedditLink(input)) return "reddit";
  if (parseHackerNewsLink(input)) return "hackernews";
  if (parseBlueskyLink(input)) return "bluesky";
  if (parseArxivLink(input) || looksLikePdfUrl(input)) return "pdf";
  return "web";
}

/** Canonical address for the kinds above, or null when the link is none of them. */
export function canonicalSourceUrl(input: string): string | null {
  return (
    parseYouTubeLink(input)?.url ??
    parseRedditLink(input)?.url ??
    parseHackerNewsLink(input)?.url ??
    parseBlueskyLink(input)?.url ??
    parseArxivLink(input)?.url ??
    null
  );
}

// ---------------------------------------------------------------------------------------------
// Query parameters on other pages

/** Parameters that only track where a click came from; dropped from canonical addresses. */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "si",
  "smid",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
  "ref",
  "ref_src",
  "ref_url",
]);

/**
 * The query string a canonical address keeps for an ordinary web page: every parameter except
 * `utm_*` and the tracking ones above, in the original order. Empty string when none is left.
 */
export function meaningfulQuery(url: URL): string {
  const kept = new URLSearchParams();
  for (const [name, value] of url.searchParams) {
    const lower = name.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) continue;
    kept.append(name, value);
  }
  const query = kept.toString();
  return query ? `?${query}` : "";
}
