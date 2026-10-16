import { browser } from "wxt/browser";
import {
  SourceError,
  detectSource,
  sourceFetchFromGlobalFetch,
  type SourceExtractResult,
  type SubstackExtractResult,
} from "@sourcefold/core";
import { extractSubstack, fetchSourceCapture, webPageToCapture } from "@sourcefold/core/capture";
import { extractXThread, type XExtractResult } from "../lib/x/extract";
import { chooseSourceRoute, PDF_TAB_MESSAGE } from "../lib/capture-route";
import { captureYouTubeVideo } from "../lib/youtube";

export type CaptureContentResponse =
  | { kind: "substack"; result: SubstackExtractResult }
  | { kind: "x"; result: XExtractResult }
  | { kind: "source"; result: SourceExtractResult }
  | { kind: "error"; message: string }
  | { kind: "unsupported" };

const LISTENER_KEY = "__SOURCEFOLD_CAPTURE_REGISTERED__";

const parseHtml = (html: string): Document => new DOMParser().parseFromString(html, "text/html");

function errorResponse(err: unknown, fallback: string): CaptureContentResponse {
  if (err instanceof SourceError) return { kind: "error", message: err.message };
  return { kind: "error", message: err instanceof Error ? err.message : fallback };
}

async function captureSource(): Promise<CaptureContentResponse> {
  try {
    const route = chooseSourceRoute(location.href, document.contentType);
    switch (route.type) {
      case "error":
        return { kind: "error", message: route.message };
      case "pdf-tab":
        return { kind: "error", message: PDF_TAB_MESSAGE };
      case "youtube-video":
        return { kind: "source", result: await captureYouTubeVideo(location.href) };
      case "fetch":
        return {
          kind: "source",
          result: await fetchSourceCapture(location.href, {
            fetch: sourceFetchFromGlobalFetch(fetch.bind(globalThis)),
            parseHtml,
          }),
        };
      case "web": {
        const capture = webPageToCapture(
          document.documentElement.outerHTML,
          location.href,
          parseHtml,
        );
        return { kind: "source", result: { status: "ok", kind: "web", capture } };
      }
    }
  } catch (err: unknown) {
    return errorResponse(err, "Failed to save this page.");
  }
}

export default defineContentScript({
  matches: [],
  registration: "runtime",
  main() {
    const globalObj = window as unknown as Record<string, boolean>;
    if (globalObj[LISTENER_KEY]) {
      return;
    }
    globalObj[LISTENER_KEY] = true;

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "sourcefold:capture") {
        return;
      }

      try {
        if (detectSource(location.href) === "x") {
          const xResult = extractXThread(document, location.href);
          sendResponse({ kind: "x", result: xResult });
          return true;
        }

        let substackResult: SubstackExtractResult;
        try {
          substackResult = extractSubstack(document, location.href);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : "Failed to extract Substack post.";
          sendResponse({ kind: "error", message: errMsg });
          return true;
        }

        if (substackResult.status !== "not_substack") {
          sendResponse({ kind: "substack", result: substackResult });
          return true;
        }

        void captureSource().then(sendResponse);
        return true;
      } catch (err: unknown) {
        sendResponse(errorResponse(err, "Unexpected error during capture."));
        return true;
      }
    });
  },
});
