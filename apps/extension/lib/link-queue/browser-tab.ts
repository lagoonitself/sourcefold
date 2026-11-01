import { browser } from "wxt/browser";
import { capturePage, type CaptureResult } from "../capture-page";
import { looksLikeSignInPage } from "./copy";
import { LINK_QUEUE_TAB_KEY } from "./state";

export async function closeLeftoverQueueTab(): Promise<void> {
  const stored = await browser.storage.local.get(LINK_QUEUE_TAB_KEY);
  const id = stored[LINK_QUEUE_TAB_KEY];
  if (typeof id !== "number") return;
  await browser.tabs.remove(id).catch(() => {});
  await browser.storage.local.remove(LINK_QUEUE_TAB_KEY);
}

export async function openQueueTab(url: string): Promise<number> {
  const tab = await browser.tabs.create({ url, active: false });
  if (tab.id == null) throw new Error("Chrome didn't open the tab.");
  try {
    await browser.storage.local.set({ [LINK_QUEUE_TAB_KEY]: tab.id });
  } catch (err) {
    // Without the stored id neither the caller nor the next start could close it.
    await browser.tabs.remove(tab.id).catch(() => {});
    throw err;
  }
  return tab.id;
}

export async function closeQueueTab(tabId: number): Promise<void> {
  try {
    await browser.tabs.remove(tabId);
  } finally {
    await browser.storage.local.remove(LINK_QUEUE_TAB_KEY);
  }
}

/** Polls the tab so the service worker stays awake for the whole load, up to `timeoutMs`. */
export async function waitForQueueTab(
  tabId: number,
  timeoutMs: number,
): Promise<"complete" | "timeout" | "closed"> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (true) {
    try {
      const tab = await browser.tabs.get(tabId);
      if (tab.status === "complete") return "complete";
    } catch {
      return "closed";
    }
    if (Date.now() >= deadline) return "timeout";
    const pause = Math.min(500, Math.max(0, deadline - Date.now()));
    await new Promise((resolve) => setTimeout(resolve, pause));
  }
}

/** Injected into the page. It must not use anything from the extension bundle. */
function pageShowsSignIn(): boolean {
  const href = location.href;
  if (/\/i\/flow\/login|\/i\/flow\/signup|\/login(?:\/|$)/i.test(href)) return true;
  const text = (document.body?.innerText ?? "").slice(0, 4000);
  return /sign in to (?:x|twitter)|log in to (?:x|twitter)/i.test(text);
}

export async function tabNeedsSignIn(tabId: number, url: string): Promise<boolean> {
  try {
    const tab = await browser.tabs.get(tabId);
    if (looksLikeSignInPage(tab.url || url, tab.title ?? "")) return true;
  } catch {
    return false;
  }
  try {
    const injected = await browser.scripting.executeScript({
      target: { tabId },
      func: pageShowsSignIn,
    });
    return injected.some((frame) => frame.result === true);
  } catch {
    return false;
  }
}

export function captureQueueTab(tabId: number): Promise<CaptureResult> {
  return capturePage(tabId);
}
