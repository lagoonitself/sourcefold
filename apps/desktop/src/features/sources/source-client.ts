import { canonicalizeUrl } from "@sourcefold/core";
import {
  fetchSourceCapture,
  listYouTubeVideos,
  type LoadPdfJs,
  type YouTubeVideoList,
} from "@sourcefold/core/capture";
import { capture, checkUrl } from "@/lib/api";
import { desktopSourceFetch } from "@/lib/web-fetch";
import type { Item } from "@/lib/types";

// YouTube videos, web pages, Reddit, Hacker News, Bluesky and PDFs are fetched by this computer
// (the Rust `web_fetch` command, so YouTube and Reddit see the user's own connection, not a cloud
// server), converted here with the shared extractors, and saved through the normal capture path:
// to the web account when signed in, to disk offline.

export type SaveSourceOutcome =
  | { kind: "saved"; title: string; item: Item }
  // Found, but nothing to save (a video without captions). Saved as an unavailable item.
  | { kind: "unavailable"; title: string; reason: string }
  | { kind: "duplicate"; title: string | null; message: string };

const parseHtml = (html: string) => new DOMParser().parseFromString(html, "text/html");

// pdf.js normally parses in a worker it loads from a separate file. Handing it the worker module
// directly makes it parse on this thread instead, which is fine for one PDF at a time and needs
// no extra bundler setup. Loaded only when a PDF is saved.
const loadPdfJs: LoadPdfJs = async () => {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.mjs"),
  ]);
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  return pdfjs;
};

function isDuplicateError(err: unknown): err is Error {
  return err instanceof Error && /already saved/i.test(err.message);
}

function alreadySaved(folderName: string | null | undefined): string {
  return `Already saved in ${folderName || "this group"}`;
}

function canonical(url: string): string {
  try {
    return canonicalizeUrl(url);
  } catch {
    return url;
  }
}

/** Fetches, converts and saves one link of the new kinds. */
export async function saveSourceLink(
  inputUrl: string,
  folderId: string,
  signal?: AbortSignal,
): Promise<SaveSourceOutcome> {
  const url = canonical(inputUrl);
  const before = await checkUrl(url, folderId);
  if (before.exists) {
    return { kind: "duplicate", title: null, message: alreadySaved(before.folder_name) };
  }

  // Throws a SourceError whose message says what to do.
  const result = await fetchSourceCapture(inputUrl, {
    fetch: desktopSourceFetch,
    parseHtml,
    loadPdfJs,
    signal,
  });

  if (result.status === "unavailable") {
    try {
      await capture({
        kind: "source_unavailable",
        folder_id: folderId,
        source: result.kind,
        url: result.url,
        title: result.title,
        reason: result.reason,
      });
    } catch (err) {
      if (!isDuplicateError(err)) throw err;
    }
    return { kind: "unavailable", title: result.title, reason: result.reason };
  }

  const { kind, capture: source } = result;
  // Redirects (a share link, a moved page) can land on something already saved.
  if (canonical(source.url) !== url) {
    const resolved = await checkUrl(source.url, folderId);
    if (resolved.exists) {
      return {
        kind: "duplicate",
        title: source.title,
        message: alreadySaved(resolved.folder_name),
      };
    }
  }

  try {
    const item = await capture({
      kind,
      folder_id: folderId,
      capture: source,
    });
    return { kind: "saved", title: source.title, item };
  } catch (err) {
    if (isDuplicateError(err))
      return { kind: "duplicate", title: source.title, message: err.message };
    throw err;
  }
}

/** The videos of a YouTube playlist or channel, newest first for channels. */
export function findYouTubeVideos(
  url: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<YouTubeVideoList> {
  return listYouTubeVideos(url, { fetch: desktopSourceFetch, ...options });
}
