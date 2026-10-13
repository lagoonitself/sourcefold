import { browser } from "wxt/browser";

const LAST_FOLDER_KEY = "lastFolderId";

export async function getLastFolderId(): Promise<string | null> {
  const result = await browser.storage.local.get([LAST_FOLDER_KEY]);
  const id = result[LAST_FOLDER_KEY];
  return typeof id === "string" && id.length > 0 ? id : null;
}

export async function setLastFolderId(folderId: string): Promise<void> {
  await browser.storage.local.set({ [LAST_FOLDER_KEY]: folderId });
}
