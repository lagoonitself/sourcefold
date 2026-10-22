/**
 * Every kind of source Sourcefold saves, with what it saves and how. Matches the README's
 * "Supported sources" table. `color` is a CSS variable from global.css; use it only to mean
 * "this source type" (tiles, the 3px row bar).
 */

export type SourceKind =
  | "grokipedia"
  | "wikipedia"
  | "youtube"
  | "substack"
  | "x"
  | "reddit"
  | "hackernews"
  | "bluesky"
  | "pdf"
  | "web"
  | "note"
  | "image";

export interface SourceInfo {
  kind: SourceKind;
  name: string;
  color: string;
  /** Which apps save it. */
  savedWith: string;
  /** What ends up in the Markdown file. */
  youGet: string;
  /** A believable example link and title for demos. */
  exampleUrl: string;
  exampleTitle: string;
}

export const SOURCES: SourceInfo[] = [
  {
    kind: "grokipedia",
    name: "Grokipedia",
    color: "var(--source-grokipedia)",
    savedWith: "Any of the three, or right-click a link",
    youGet: "The full article with tables, links and every reference as a footnote",
    exampleUrl: "grokipedia.com/page/Turbocharger",
    exampleTitle: "Turbocharger",
  },
  {
    kind: "wikipedia",
    name: "Wikipedia",
    color: "var(--source-wikipedia)",
    savedWith: "Any of the three",
    youGet: "The full article with its infobox, images and references",
    exampleUrl: "en.wikipedia.org/wiki/Wankel_engine",
    exampleTitle: "Wankel engine",
  },
  {
    kind: "youtube",
    name: "YouTube",
    color: "var(--source-youtube)",
    savedWith: "Desktop app or extension, plus whole playlists and channels",
    youGet:
      "The English transcript in timestamped paragraphs that open the video at that second, plus the description",
    exampleUrl: "youtube.com/watch?v=Q3pWg1Zt9ac",
    exampleTitle: "How turbo lag actually works",
  },
  {
    kind: "substack",
    name: "Substack",
    color: "var(--source-substack)",
    savedWith: "Desktop app or extension, plus whole publications between two dates",
    youGet: "Free posts, and paid posts you subscribe to, with their images",
    exampleUrl: "enginebay.substack.com/p/the-last-rotary",
    exampleTitle: "The last rotary",
  },
  {
    kind: "x",
    name: "X",
    color: "var(--source-x)",
    savedWith: "Extension",
    youGet: "A single post or the author's whole thread, replies kept as a tree, photos and GIFs",
    exampleUrl: "x.com/boostlab/status/1849",
    exampleTitle: "Thread: why twin-scroll beats twin-turbo",
  },
  {
    kind: "reddit",
    name: "Reddit",
    color: "var(--source-reddit)",
    savedWith: "Extension, with the thread open",
    youGet: "The post and its comments",
    exampleUrl: "reddit.com/r/cars/comments/1g7…",
    exampleTitle: "Is the 2JZ overrated?",
  },
  {
    kind: "hackernews",
    name: "Hacker News",
    color: "var(--source-hackernews)",
    savedWith: "Any of the three",
    youGet: "The story and its comment thread",
    exampleUrl: "news.ycombinator.com/item?id=41824",
    exampleTitle: "Electric turbos are finally here",
  },
  {
    kind: "bluesky",
    name: "Bluesky",
    color: "var(--source-bluesky)",
    savedWith: "Any of the three",
    youGet: "The post or thread",
    exampleUrl: "bsky.app/profile/torque.dev/post/3l…",
    exampleTitle: "Dyno day notes",
  },
  {
    kind: "pdf",
    name: "PDF and arXiv",
    color: "var(--source-pdf)",
    savedWith: "Website or desktop app",
    youGet: "The document's text, with math kept",
    exampleUrl: "arxiv.org/abs/2308.08708",
    exampleTitle: "Transient response of variable-geometry turbines",
  },
  {
    kind: "web",
    name: "Any web page",
    color: "var(--source-web)",
    savedWith: "Any of the three",
    youGet: "The main article (news, blogs, docs), without menus and ads",
    exampleUrl: "caranddriver.com/features/turbo-explained",
    exampleTitle: "Turbochargers, explained",
  },
];

/** Notes and images aren't saved from links, but sit next to sources in a group. */
export const EXTRA_KINDS: SourceInfo[] = [
  {
    kind: "note",
    name: "Note",
    color: "var(--source-note)",
    savedWith: "Written in any app",
    youGet: "Your own Markdown note, next to your sources",
    exampleUrl: "",
    exampleTitle: "Script ideas for the intro",
  },
  {
    kind: "image",
    name: "Image",
    color: "var(--source-image)",
    savedWith: "Uploaded in the website or desktop app",
    youGet: "The image, kept in your Drive",
    exampleUrl: "",
    exampleTitle: "Dyno chart, 2JZ stock vs single turbo",
  },
];

export const sourceByKind = (kind: SourceKind) =>
  [...SOURCES, ...EXTRA_KINDS].find((s) => s.kind === kind)!;
