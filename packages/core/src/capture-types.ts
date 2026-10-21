// Shapes the extension sends to POST /api/capture and POST /api/x/:itemId/posts.

export interface XPostCapture {
  postUrl: string;
  authorName: string;
  handle: string; // without the leading @
  authorUrl: string;
  postedAt: string | null; // ISO 8601 from time[datetime]
  text: string;
  /** The post's own photos, GIFs and videos, in order (not a quoted post's). Missing = none known. */
  media?: XMedia[];
}

/**
 * A photo, GIF or video in an X post (docs/dev/handoff-x-media.md). Photos and GIFs are saved
 * with the post; a video is only linked (the link is the post itself).
 * - photo url: https://pbs.twimg.com/media/<id>.<ext>?name=orig
 * - gif url: https://video.twimg.com/tweet_video/<id>.mp4 (X keeps GIFs as short MP4s)
 */
export type XMedia =
  | { type: "photo"; url: string; alt: string | null }
  | { type: "gif"; url: string; alt: string | null }
  | { type: "video"; durationSeconds: number | null };

export interface SubstackCapture {
  url: string; // canonical post URL (link rel=canonical)
  title: string;
  subtitle: string | null;
  author: string | null;
  authorUrl: string | null;
  publication: string | null;
  publicationUrl: string | null;
  published: string | null; // ISO 8601
  access: "free" | "paid";
  markdown: string; // body only, no front matter, no title heading
}

export type SubstackExtractResult =
  | { status: "ok"; capture: SubstackCapture }
  | { status: "paywalled"; url: string; title: string }
  | { status: "not_substack" };

export interface WikipediaCapture {
  url: string; // canonical article address, after redirects: https://<language>.wikipedia.org/wiki/<Title>
  title: string;
  summary: string | null; // Wikipedia's short description
  language: string; // edition code: en, de, zh-yue
  revision: string | null; // revision id the text was taken from
  lastEdited: string | null; // ISO 8601, when that revision was saved
  markdown: string; // body only, no front matter, no title heading
}

/**
 * Source kinds added on 2026-10-16. They all share one capture shape: the front matter fields
 * that are particular to the kind travel in `meta`, keyed exactly as in docs/FILE-FORMAT.md.
 */
export const SOURCE_CAPTURE_KINDS = [
  "youtube",
  "web",
  "reddit",
  "pdf",
  "hackernews",
  "bluesky",
] as const;

export type SourceCaptureKind = (typeof SOURCE_CAPTURE_KINDS)[number];

export function isSourceCaptureKind(value: unknown): value is SourceCaptureKind {
  return typeof value === "string" && (SOURCE_CAPTURE_KINDS as readonly string[]).includes(value);
}

/** One front matter value: strings are dates or text, numbers are written unquoted. */
export type SourceMetaValue = string | number | null;

export interface SourceCapture {
  /** The source's own address, after redirects, as written in the `url` front matter field. */
  url: string;
  title: string;
  /** The kind's front matter fields (FILE-FORMAT "Front matter"), for example `channel`. */
  meta: Record<string, SourceMetaValue>;
  /** Body only: no front matter, no `# Title`, no "Saved from" line. */
  markdown: string;
}

/** What an extractor returns. Errors it can explain are thrown as a `SourceError`. */
export type SourceExtractResult =
  | { status: "ok"; kind: SourceCaptureKind; capture: SourceCapture }
  // Found, but there is nothing to save (a YouTube video without captions). Saved as an
  // `unavailable` item so the list shows why, like a locked paid Substack post.
  | { status: "unavailable"; kind: SourceCaptureKind; url: string; title: string; reason: string };

export type CaptureRequest =
  | { kind: "substack"; folder_id: string; capture: SubstackCapture }
  | { kind: "wikipedia"; folder_id: string; capture: WikipediaCapture }
  | { kind: SourceCaptureKind; folder_id: string; capture: SourceCapture }
  | {
      kind: "source_unavailable";
      folder_id: string;
      source: SourceCaptureKind;
      url: string;
      title: string;
      reason: string;
    }
  | { kind: "substack_unavailable"; folder_id: string; url: string; title: string }
  // posts[0] is the root; each next post replies to the one before it (the author's own thread).
  | { kind: "x"; folder_id: string; posts: XPostCapture[] };

export interface XTreeNode {
  id: string;
  parentId: string | null;
  position: number;
  postUrl: string;
  authorName: string;
  handle: string;
  authorUrl: string;
  postedAt: string | null;
  text: string;
  media?: XMedia[];
}
