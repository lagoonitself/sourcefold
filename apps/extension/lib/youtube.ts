import {
  SourceError,
  parseYouTubeLink,
  sourceFetchFromGlobalFetch,
  type SourceExtractResult,
} from "@sourcefold/core";
import { fetchYouTubeCapture } from "@sourcefold/core/capture";

// Runs in the content script on youtube.com. The requests are same-origin from the page, so they
// go out on the user's own connection with their YouTube cookies (consent already given, signed
// in if they are), which YouTube treats like the page itself asking.

/** True on a youtube.com page that shows one video (watch, shorts, live). */
export function isYouTubeVideoPage(href: string): boolean {
  return parseYouTubeLink(href)?.type === "video";
}

/**
 * Fetches the transcript of the video on this page. A video with no captions comes back as
 * `unavailable`; errors YouTube explains are thrown as a `SourceError` with a message for the user.
 */
export async function captureYouTubeVideo(href: string): Promise<SourceExtractResult> {
  if (!isYouTubeVideoPage(href)) {
    throw new SourceError("invalid_url", "Open a single YouTube video to save its transcript.");
  }
  const fetch = sourceFetchFromGlobalFetch(globalThis.fetch.bind(globalThis));
  return fetchYouTubeCapture(href, { fetch });
}
