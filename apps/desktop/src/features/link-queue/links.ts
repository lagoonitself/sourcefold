import {
  classifySubstackLink,
  detectLinkKind,
  detectSource,
  isWikipediaArticleUrl,
  parseYouTubeLink,
  SourceError,
} from "@sourcefold/core";
import { isYouTubeRateLimit } from "@sourcefold/core/capture";

/** The same split Add links uses before it saves. `kind: "x"` wins, so a queued X post is never fetched here. */
export type QueuedLinkKind =
  | "x"
  | "grokipedia"
  | "wikipedia"
  | "substack"
  | "publication"
  | "youtube_list"
  | "source"
  | "unknown";

export function classifyQueuedLink(url: string, kind: string | null): QueuedLinkKind {
  if (kind === "x") return "x";
  const source = detectSource(url);
  const substack = classifySubstackLink(url);
  if (source === "grokipedia") return "grokipedia";
  if (isWikipediaArticleUrl(url)) return "wikipedia";
  if (source === "x") return "x";
  if (substack === "post") return "substack";
  if (substack === "publication") return "publication";
  if (detectLinkKind(url) === "youtube" && parseYouTubeLink(url)?.type !== "video") {
    return "youtube_list";
  }
  if (detectLinkKind(url)) return "source";
  return "unknown";
}

/**
 * The site refused this computer too (HTTP 401/403/429, a bot wall, a captcha).
 * YouTube's own limit is paced and tried again, not handed to Chrome.
 * A Substack refusal goes to Chrome too: the user may be signed in to Substack there.
 */
export function needsBrowser(error: unknown): boolean {
  if (isYouTubeRateLimit(error)) return false;
  if (error instanceof SourceError && error.code === "blocked") return true;
  const message = error instanceof Error ? error.message : "";
  if (/the site refused|this site refused|substack refused/i.test(message)) return true;
  if (/captcha|bot wall|not a bot/i.test(message)) return true;
  return false;
}
