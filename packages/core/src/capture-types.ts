// Shapes the extension sends to POST /api/capture and POST /api/x/:itemId/posts.

export interface XPostCapture {
  postUrl: string;
  authorName: string;
  handle: string; // without the leading @
  authorUrl: string;
  postedAt: string | null; // ISO 8601 from time[datetime]
  text: string;
}

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

export type CaptureRequest =
  | { kind: "substack"; folder_id: string; capture: SubstackCapture }
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
}
