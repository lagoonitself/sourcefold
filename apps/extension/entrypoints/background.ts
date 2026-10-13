import { browser } from "wxt/browser";
import { detectSource } from "@sourcefold/core";
import { saveGrokipedia, ApiError } from "../lib/api";
import { getLastFolderId } from "../lib/last-folder";

const SUCCESS_COLOR = "#1F5E4E";
const ERROR_COLOR = "#B42318";

let clearTimer: ReturnType<typeof setTimeout> | null = null;

async function showSuccessBadge() {
  if (clearTimer) clearTimeout(clearTimer);
  await browser.action.setBadgeBackgroundColor({ color: SUCCESS_COLOR });
  await browser.action.setBadgeText({ text: "✓" });
  await browser.action.setTitle({ title: "Sourcefold" });

  clearTimer = setTimeout(async () => {
    await browser.action.setBadgeText({ text: "" });
  }, 3000);
}

async function showErrorBadge(title: string) {
  if (clearTimer) clearTimeout(clearTimer);
  await browser.action.setBadgeBackgroundColor({ color: ERROR_COLOR });
  await browser.action.setBadgeText({ text: "!" });
  await browser.action.setTitle({ title });
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: "save-link",
      title: "Save link to Sourcefold",
      contexts: ["link"],
    });
  });

  browser.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId === "save-link" && info.linkUrl) {
      const source = detectSource(info.linkUrl);

      if (source === "grokipedia") {
        const lastFolderId = await getLastFolderId();
        if (!lastFolderId) {
          await showErrorBadge("Choose a folder in the popup first");
          return;
        }

        try {
          await saveGrokipedia(info.linkUrl, lastFolderId);
          await showSuccessBadge();
        } catch (err: unknown) {
          const message =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Failed to save link.";
          await showErrorBadge(message);
        }
      } else {
        await showErrorBadge("Open the page first, then save it from the popup.");
      }
    }
  });
});
