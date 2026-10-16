// Reads Reddit's public post JSON (`https://www.reddit.com/r/<sub>/comments/<id>.json`) and
// renders the body of the saved file: the post's own text (or link line) and the top comments
// as nested blockquotes, like the X threads.

import type { SourceMetaValue } from "../capture-types";
import { formatDate } from "../front-matter";

/** One comment and its replies, already sorted and filtered. */
export interface RedditComment {
  id: string;
  author: string | null;
  body: string;
  score: number | null;
  createdUtc: number | null;
  permalink: string | null;
  replies: RedditComment[];
}

/** A post and the comments kept from its listing. */
export interface RedditThread {
  title: string;
  subreddit: string | null;
  author: string | null;
  createdUtc: number | null;
  score: number | null;
  commentCount: number | null;
  /** The post's own part of the body: selftext, images or a link line. */
  body: string;
  comments: RedditComment[];
}

/** Five levels of comments: the top level is depth 0. */
const MAX_DEPTH = 4;
/** The most comments a saved file keeps, read in order. */
const MAX_COMMENTS = 200;

const GONE = new Set(["[deleted]", "[removed]"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function field(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `[deleted]` and `[removed]` bodies are empty comments Reddit keeps for the replies. */
function isGone(body: string): boolean {
  return GONE.has(body.trim());
}

/** An author name without the `u/`; `[deleted]` and empty names are unknown. */
export function redditAuthorName(value: unknown): string | null {
  const raw = field(value)?.trim() ?? "";
  const name = raw.startsWith("u/") ? raw.slice(2) : raw;
  if (!name || isGone(name)) return null;
  return name;
}

export function redditPostedDate(createdUtc: number | null): string | null {
  if (createdUtc === null) return null;
  try {
    return formatDate(new Date(createdUtc * 1000));
  } catch {
    return null;
  }
}

function isRedditPermalink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host === "reddit.com" || host.endsWith(".reddit.com");
  } catch {
    return false;
  }
}

/** The images of a gallery post, from `gallery_data` and `media_metadata`, in order. */
function galleryImages(data: Record<string, unknown>): string[] {
  const galleryData = isRecord(data.gallery_data) ? data.gallery_data : null;
  const metadata = isRecord(data.media_metadata) ? data.media_metadata : null;
  if (!galleryData || !metadata) return [];

  const items = Array.isArray(galleryData.items) ? galleryData.items : [];
  const urls: string[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const mediaId = field(item.media_id);
    const media = mediaId ? metadata[mediaId] : null;
    if (!isRecord(media)) continue;
    const source = isRecord(media.s) ? media.s : null;
    const url = source ? (field(source.u) ?? field(source.gif)) : null;
    if (url) urls.push(url);
  }
  return urls;
}

function postUrl(data: Record<string, unknown>): string | null {
  const url = field(data.url)?.trim();
  return url ? url : null;
}

/** The post's own body: selftext, gallery images, an image link, or a link line. */
function postBody(data: Record<string, unknown>): string {
  const selftext = field(data.selftext)?.trim() ?? "";
  if (selftext && !isGone(selftext)) return selftext;

  const images = galleryImages(data);
  if (images.length > 0) {
    return images.map((url) => `![](${url})`).join("\n\n");
  }

  const url = postUrl(data);
  if (!url) return "";

  const isSelf = data.is_self === true || (data.post_hint == null && isRedditPermalink(url));
  if (isSelf) return "";

  if (field(data.post_hint) === "image" || isImageUrl(url)) return `![](${url})`;
  return `[${url}](${url})`;
}

function isImageUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === "i.redd.it";
  } catch {
    return false;
  }
}

function sortByScore(comments: RedditComment[]): RedditComment[] {
  return comments
    .map((comment, index) => ({ comment, index }))
    .sort((a, b) => {
      const scoreA = a.comment.score ?? Number.NEGATIVE_INFINITY;
      const scoreB = b.comment.score ?? Number.NEGATIVE_INFINITY;
      return scoreB - scoreA || a.index - b.index;
    })
    .map((entry) => entry.comment);
}

function parseComment(value: unknown, depth: number): RedditComment | null {
  if (!isRecord(value) || value.kind !== "t1" || !isRecord(value.data)) return null;
  const data = value.data;

  const body = (field(data.body) ?? "").trim();
  const replies = parseReplies(data.replies, depth + 1);
  if ((body === "" || isGone(body)) && replies.length === 0) return null;

  return {
    id: field(data.id) ?? "",
    author: redditAuthorName(data.author),
    body,
    score: count(data.score),
    createdUtc: count(data.created_utc),
    permalink: field(data.permalink),
    replies,
  };
}

function parseReplies(value: unknown, depth: number): RedditComment[] {
  if (depth > MAX_DEPTH) return [];
  const listing = isRecord(value) ? value : null;
  const data = listing && isRecord(listing.data) ? listing.data : null;
  const children = data && Array.isArray(data.children) ? data.children : [];

  const comments: RedditComment[] = [];
  for (const child of children) {
    const comment = parseComment(child, depth);
    if (comment) comments.push(comment);
  }
  return sortByScore(comments);
}

function listingChildren(value: unknown): unknown[] {
  if (!isRecord(value)) return [];
  const data = isRecord(value.data) ? value.data : null;
  return data && Array.isArray(data.children) ? data.children : [];
}

/**
 * Reads the `[postListing, commentListing]` pair Reddit's `.json` returns. Null when the
 * response isn't a post listing (a missing post, or a different shape).
 */
export function parseRedditThread(json: unknown): RedditThread | null {
  if (!Array.isArray(json)) return null;
  const post = listingChildren(json[0]).find(
    (child) => isRecord(child) && child.kind === "t3" && isRecord(child.data),
  );
  if (!isRecord(post) || !isRecord(post.data)) return null;
  const data = post.data;

  const title = (field(data.title) ?? "").trim();
  if (!title) return null;

  const subreddit = field(data.subreddit)?.trim().toLowerCase();

  return {
    title,
    subreddit: subreddit ? subreddit : null,
    author: redditAuthorName(data.author),
    createdUtc: count(data.created_utc),
    score: count(data.score),
    commentCount: count(data.num_comments),
    body: postBody(data),
    comments: parseReplies(json[1], 0),
  };
}

/** The front matter fields for a Reddit item, in FILE-FORMAT order. */
export function redditMeta(thread: RedditThread): Record<string, SourceMetaValue> {
  return {
    subreddit: thread.subreddit,
    author: thread.author,
    posted: redditPostedDate(thread.createdUtc),
    score: thread.score,
    comments: thread.commentCount,
  };
}

/** The comments to write, in reading order, at their blockquote depth. */
function flattenComments(
  comments: RedditComment[],
  max = MAX_COMMENTS,
): { comment: RedditComment; depth: number }[] {
  const kept: { comment: RedditComment; depth: number }[] = [];

  function visit(comment: RedditComment, depth: number) {
    if (kept.length >= max) return;
    kept.push({ comment, depth });
    for (const reply of comment.replies) {
      visit(reply, depth + 1);
    }
  }

  for (const comment of comments) {
    visit(comment, 0);
  }
  return kept;
}

function commentLink(comment: RedditComment): string {
  const permalink = comment.permalink?.trim();
  return permalink ? `https://www.reddit.com${permalink}` : "";
}

function renderCommentLines(comment: RedditComment, depth: number): string[] {
  const prefix = "> ".repeat(depth);
  const blank = prefix.trimEnd();

  const parts = [`**u/${comment.author ?? "[deleted]"}**`];
  if (comment.score !== null) parts.push(`${comment.score} points`);
  const posted = redditPostedDate(comment.createdUtc);
  if (posted) parts.push(posted);
  const link = commentLink(comment);
  if (link) parts.push(`[link](${link})`);

  const lines = [`${prefix}${parts.join(" · ")}`, blank];
  for (const line of comment.body.split(/\r?\n/)) {
    if (line === "") {
      lines.push(blank);
    } else {
      // A leading # inside a blockquote would read as a heading; keep it as text.
      const text = line.startsWith("#") ? `\\${line}` : line;
      lines.push(`${prefix}${text}`);
    }
  }
  return lines;
}

/** The saved body: the post, then `## Comments` when any comment is kept. */
export function renderRedditMarkdown(thread: RedditThread): string {
  const blocks: string[] = [];
  const body = thread.body.trim();
  if (body) blocks.push(body);

  const ordered = flattenComments(thread.comments);
  if (ordered.length > 0) {
    const lines: string[] = ["## Comments", ""];
    ordered.forEach((entry, index) => {
      if (index > 0) {
        const previous = ordered[index - 1]!.depth;
        lines.push("> ".repeat(Math.min(previous, entry.depth)).trimEnd());
      }
      lines.push(...renderCommentLines(entry.comment, entry.depth));
    });
    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n");
}
