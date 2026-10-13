import { browser } from "wxt/browser";
import { detectSource, type SubstackExtractResult } from "@sourcefold/core";
import { extractSubstack } from "@sourcefold/core/capture";
import { extractXThread, type XExtractResult } from "../lib/x/extract";

export type CaptureContentResponse =
  | { kind: "substack"; result: SubstackExtractResult }
  | { kind: "x"; result: XExtractResult }
  | { kind: "error"; message: string }
  | { kind: "unsupported" };

const LISTENER_KEY = "__SOURCEFOLD_CAPTURE_REGISTERED__";

export default defineContentScript({
  matches: ["<all_urls>"],
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

        if (detectSource(location.href) === "x") {
          const xResult = extractXThread(document, location.href);
          sendResponse({ kind: "x", result: xResult });
          return true;
        }

        sendResponse({ kind: "unsupported" });
        return true;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : "Unexpected error during capture.";
        sendResponse({ kind: "error", message: errMsg });
        return true;
      }
    });
  },
});
