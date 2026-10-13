import { browser } from "wxt/browser";
import type { CaptureContentResponse } from "../entrypoints/capture.content";

export type CaptureResult = CaptureContentResponse;

export async function capturePage(tabId: number): Promise<CaptureResult> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["/content-scripts/capture.js"],
    });
  } catch {
    return { kind: "unsupported" };
  }

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout waiting for content script response")), 10000),
    );

    const response = (await Promise.race([
      browser.tabs.sendMessage(tabId, {
        type: "sourcefold:capture",
      }),
      timeoutPromise,
    ])) as CaptureContentResponse | undefined;

    if (!response || typeof response !== "object" || !("kind" in response)) {
      return { kind: "unsupported" };
    }

    return response;
  } catch {
    return { kind: "unsupported" };
  }
}
