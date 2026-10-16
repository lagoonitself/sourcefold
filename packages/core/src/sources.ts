// One entry point for the source kinds added on 2026-10-16: routes a pasted link to its
// extractor. Each app passes its own network access (`SourceFetch`) and HTML parser.

import { fetchBlueskyCapture } from "./bluesky";
import type { SourceExtractResult } from "./capture-types";
import { fetchHackerNewsCapture } from "./hackernews";
import { fetchPdfCapture, type LoadPdfJs } from "./pdf";
import { fetchRedditCapture } from "./reddit";
import { SourceError, type SourceFetch } from "./source-fetch";
import { detectLinkKind, parseYouTubeLink } from "./source-links";
import { fetchWebPageCapture, WebPageIsPdfError } from "./web-page";
import { fetchYouTubeCapture } from "./youtube";

export interface SourceCaptureDeps {
  fetch: SourceFetch;
  parseHtml: (html: string) => Document;
  /** How to load pdf.js; defaults to its legacy build (right for Node). */
  loadPdfJs?: LoadPdfJs;
  signal?: AbortSignal;
}

/**
 * Fetches and converts any link of the new kinds: YouTube videos, Reddit threads, Hacker News
 * items, Bluesky posts, PDFs and arXiv papers, and any other web page. A web page that turns out
 * to be a PDF goes to the PDF extractor. YouTube playlists and channels aren't single sources:
 * list them with `listYouTubeVideos` first. Errors are `SourceError`s with a message for the user.
 */
export async function fetchSourceCapture(
  url: string,
  deps: SourceCaptureDeps,
): Promise<SourceExtractResult> {
  const { fetch, parseHtml, loadPdfJs, signal } = deps;
  switch (detectLinkKind(url)) {
    case "youtube":
      if (parseYouTubeLink(url)?.type !== "video") {
        throw new SourceError(
          "invalid_url",
          "That's a YouTube playlist or channel. Add it in the desktop app to pick its videos.",
        );
      }
      return fetchYouTubeCapture(url, { fetch, signal });
    case "reddit":
      return fetchRedditCapture(url, { fetch, signal });
    case "hackernews":
      return fetchHackerNewsCapture(url, { fetch, signal });
    case "bluesky":
      return fetchBlueskyCapture(url, { fetch, signal });
    case "pdf":
      return fetchPdfCapture(url, { fetch, parseHtml, loadPdfJs, signal });
    case "web":
      try {
        return await fetchWebPageCapture(url, { fetch, parseHtml, signal });
      } catch (error) {
        if (error instanceof WebPageIsPdfError) {
          return fetchPdfCapture(error.url, { fetch, parseHtml, loadPdfJs, signal });
        }
        throw error;
      }
    default:
      throw new SourceError("invalid_url", "That isn't a link Sourcefold can open.");
  }
}
