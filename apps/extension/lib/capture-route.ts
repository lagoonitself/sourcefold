import { detectLinkKind, parseYouTubeLink, type SourceCaptureKind } from "@sourcefold/core";

/** How the content script saves a page that isn't X or Substack. */
export type SourceRoute =
  | { type: "youtube-video" }
  | { type: "fetch" } // Reddit, Hacker News, Bluesky: fetched from the page's own origin
  | { type: "pdf-tab" }
  | { type: "web" } // the live page, as the user sees it
  | { type: "error"; message: string };

export const PDF_TAB_MESSAGE = "Save PDFs from Add links in Sourcefold.";
export const YOUTUBE_LIST_MESSAGE =
  "Open a single video to save its transcript, or add the playlist in the desktop app.";

export function chooseSourceRoute(href: string, contentType: string): SourceRoute {
  const kind = detectLinkKind(href);
  if (kind === null) return { type: "error", message: "This page can't be saved." };
  if (kind === "youtube") {
    return parseYouTubeLink(href)?.type === "video"
      ? { type: "youtube-video" }
      : { type: "error", message: YOUTUBE_LIST_MESSAGE };
  }
  if (kind === "reddit" || kind === "hackernews" || kind === "bluesky") return { type: "fetch" };
  if (kind === "pdf" || contentType === "application/pdf") {
    return { type: "pdf-tab" };
  }
  return { type: "web" };
}

const LABELS: Record<SourceCaptureKind, string> = {
  youtube: "YouTube transcript",
  web: "Web page",
  reddit: "Reddit thread",
  hackernews: "Hacker News thread",
  bluesky: "Bluesky post",
  pdf: "PDF",
};

export function sourceKindLabel(kind: SourceCaptureKind): string {
  return LABELS[kind];
}
