import { browser } from "wxt/browser";
import type { Folder } from "./api";
import type { ResolvedTarget } from "./target";

// The popup paints from this at once and refreshes it in the background, so opening it never
// waits on the desktop app or the network. It holds no token.
const POPUP_CACHE_KEY = "sourcefold:popupCache";

export interface TargetSnapshot {
  key: string;
  type: ResolvedTarget["type"];
  displayLabel: string;
}

export interface PopupCache {
  target: TargetSnapshot;
  folders: Folder[];
}

export function snapshotOf(target: ResolvedTarget): TargetSnapshot {
  const key = target.type === "account" ? `account:${target.email ?? target.via}` : target.type;
  return { key, type: target.type, displayLabel: target.displayLabel };
}

export async function readPopupCache(): Promise<PopupCache | null> {
  const result = await browser.storage.local.get([POPUP_CACHE_KEY]);
  const cache = result[POPUP_CACHE_KEY] as PopupCache | undefined;
  if (!cache?.target?.key || !Array.isArray(cache.folders)) return null;
  return cache;
}

export async function writePopupCache(cache: PopupCache): Promise<void> {
  await browser.storage.local.set({ [POPUP_CACHE_KEY]: cache });
}
