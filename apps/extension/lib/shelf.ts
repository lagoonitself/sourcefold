import { browser } from "wxt/browser";
import {
  shelfKey,
  type ShelfAddResult,
  type ShelfLink,
  type ShelfLinkInput,
  type ShelfLinkPatch,
} from "@sourcefold/core";
import { sourcefoldRequest } from "./api";

// The Link Shelf in the extension (docs/dev/PLAN-shelf.md). The popup and the toolbar badge read
// a cache in storage.local, keyed by shelfKey, so neither waits on the network. The cache is
// refreshed at most every five minutes, and right after the popup shelves something.

export const SHELF_INDEX_KEY = "sourcefold:shelfIndex";
export const SHELF_REFRESH_MS = 5 * 60_000;

interface ShelfIndex {
  fetchedAt: number;
  byKey: Record<string, ShelfLink>;
}

const EMPTY_INDEX: ShelfIndex = { fetchedAt: 0, byKey: {} };

let inFlight: Promise<void> | null = null;
let lastAttempt = 0;

async function readIndex(): Promise<ShelfIndex> {
  const result = await browser.storage.local.get([SHELF_INDEX_KEY]);
  const index = result[SHELF_INDEX_KEY] as ShelfIndex | undefined;
  if (!index || typeof index.byKey !== "object" || !index.byKey) return EMPTY_INDEX;
  return index;
}

async function writeIndex(index: ShelfIndex): Promise<void> {
  await browser.storage.local.set({ [SHELF_INDEX_KEY]: index });
}

/** Puts links into the cache. A link whose URL changed drops the entry under its old key. */
async function cacheLinks(links: ShelfLink[]): Promise<void> {
  if (links.length === 0) return;
  const index = await readIndex();
  const byKey = { ...index.byKey };
  for (const link of links) {
    for (const key of Object.keys(byKey)) {
      if (byKey[key]?.id === link.id && key !== link.key) delete byKey[key];
    }
    byKey[link.key] = link;
  }
  await writeIndex({ ...index, byKey });
}

/** Every link on the shelf, as the account (or the desktop app offline) holds them. */
export function listShelf(): Promise<ShelfLink[]> {
  return sourcefoldRequest<ShelfLink[]>({ type: "list_shelf" }, "/api/shelf");
}

/** Shelves one page. The cache is updated at once and refreshed in the background. */
export async function addToShelf(input: ShelfLinkInput): Promise<ShelfAddResult> {
  const result = await sourcefoldRequest<ShelfAddResult>(
    { type: "add_shelf_links", links: [input] },
    "/api/shelf",
    { method: "POST", body: JSON.stringify({ links: [input] }) },
  );
  await cacheLinks([...result.added, ...result.existing]).catch(() => {});
  void refreshShelfIndex({ force: true }).catch(() => {});
  return result;
}

/** Saves a note, tags, title or pin of one shelf link. */
export async function updateShelfLink(id: string, patch: ShelfLinkPatch): Promise<ShelfLink> {
  const link = await sourcefoldRequest<ShelfLink>(
    { type: "update_shelf_link", id, patch },
    `/api/shelf/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  await cacheLinks([link]).catch(() => {});
  return link;
}

/**
 * Reloads the cached index. Without `force` it does nothing when the last attempt (from this
 * context) or the stored index is less than five minutes old, so a failing network isn't retried
 * on every tab change.
 */
export function refreshShelfIndex(options: { force?: boolean } = {}): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (!options.force) {
      const stored = await readIndex();
      const last = Math.max(stored.fetchedAt, lastAttempt);
      if (Date.now() - last < SHELF_REFRESH_MS) return;
    }
    lastAttempt = Date.now();
    const links = await listShelf();
    const byKey: Record<string, ShelfLink> = {};
    for (const link of links) byKey[link.key] = link;
    await writeIndex({ fetchedAt: Date.now(), byKey });
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Drops the cached index, for example on sign-out or when the connection mode changes. */
export async function clearShelfIndex(): Promise<void> {
  lastAttempt = 0;
  await browser.storage.local.remove(SHELF_INDEX_KEY);
}

/** The shelf link for a page, read from the cache only (no network). */
export async function findShelfLink(url: string): Promise<ShelfLink | undefined> {
  const key = shelfKey(url);
  if (!key) return undefined;
  const index = await readIndex();
  return index.byKey[key];
}

/** Why a page can't go on the shelf, or null when it can. */
export function shelfBlockReason(url: string): string | null {
  if (!shelfKey(url)) return "Only web pages (http or https) can go on the shelf.";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Only web pages (http or https) can go on the shelf.";
  }
  const host = parsed.hostname.toLowerCase();
  const webStore =
    host === "chromewebstore.google.com" ||
    (host === "chrome.google.com" && parsed.pathname.startsWith("/webstore"));
  if (webStore) return "Chrome Web Store pages can't go on the shelf.";
  return null;
}
