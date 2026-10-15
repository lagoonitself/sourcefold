import { canonicalWikipediaUrl } from "@sourcefold/core";
import {
  WIKIPEDIA_ERROR_MESSAGES,
  fetchWikipediaCapture,
  type WikipediaFetchOptions,
} from "@sourcefold/core/capture";
import { capture, checkUrl } from "@/lib/api";
import type { Item } from "@/lib/types";

// Wikipedia articles are fetched here, in the webview: Wikimedia's API sends CORS headers, so no
// help from Rust is needed. The page is converted to Markdown with the shared converter and saved
// through the normal capture path: to the web account when signed in, to disk offline.

export type SaveWikipediaOutcome =
  | { kind: "saved"; title: string; item: Item }
  | { kind: "duplicate"; title: string | null; message: string };

const parseHtml: WikipediaFetchOptions["parseHtml"] = (html) =>
  new DOMParser().parseFromString(html, "text/html");

function isDuplicateError(err: unknown): err is Error {
  return err instanceof Error && /already saved/i.test(err.message);
}

function alreadySaved(folderName: string | null | undefined): string {
  return `Already saved in ${folderName || "this group"}`;
}

export async function saveWikipediaArticle(
  inputUrl: string,
  folderId: string,
): Promise<SaveWikipediaOutcome> {
  const url = canonicalWikipediaUrl(inputUrl);
  if (!url) throw new Error(WIKIPEDIA_ERROR_MESSAGES.invalid_url);

  const before = await checkUrl(url, folderId);
  if (before.exists) {
    return { kind: "duplicate", title: null, message: alreadySaved(before.folder_name) };
  }

  // Throws a WikipediaError whose message says what to do ("Couldn't reach Wikipedia…").
  const article = await fetchWikipediaCapture(url, { parseHtml });

  // The link may have been a redirect to an article that is already saved.
  if (article.url !== url) {
    const resolved = await checkUrl(article.url, folderId);
    if (resolved.exists) {
      return {
        kind: "duplicate",
        title: article.title,
        message: alreadySaved(resolved.folder_name),
      };
    }
  }

  try {
    const item = await capture({ kind: "wikipedia", folder_id: folderId, capture: article });
    return { kind: "saved", title: article.title, item };
  } catch (err) {
    if (isDuplicateError(err)) {
      return { kind: "duplicate", title: article.title, message: err.message };
    }
    throw err;
  }
}
