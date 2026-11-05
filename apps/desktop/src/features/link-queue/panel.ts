import {
  describeQueuedLink,
  summarizeLinks,
  type LinkStatus,
  type LinkWorkersSeen,
  type LinkStatusSummary,
} from "@sourcefold/core";
import type { LinkQueueRow } from "./types";

// The pure parts of the "Links from Claude" panel and the top-bar button: which results the
// person hasn't looked at, which links Chrome just saved, and the short summary text.

export const LAST_LOOKED_KEY = "sourcefold:links-last-looked";
export const RESULT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const REFRESH_OPEN_MS = 10_000;
export const CHECK_IN_MS = 60_000;

type Store = Pick<Storage, "getItem" | "setItem">;

function defaultStore(): Store | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

/** When the person last opened the panel, as a time in ms. 0 when never. */
export function readLastLooked(store: Store | null = defaultStore()): number {
  const value = Number(store?.getItem(LAST_LOOKED_KEY) ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function writeLastLooked(now = Date.now(), store: Store | null = defaultStore()): void {
  try {
    store?.setItem(LAST_LOOKED_KEY, String(now));
  } catch {
    // Storage can be refused; the button then just keeps showing.
  }
}

/** Still moving: the poll runs while any of these exist. */
export function isOpenRow(row: Pick<LinkQueueRow, "status">): boolean {
  return row.status === "waiting" || row.status === "working";
}

/** Results worth announcing: saved, already saved or nothing to save (not cancelled). */
export function isResultRow(row: Pick<LinkQueueRow, "status">): boolean {
  return row.status === "saved" || row.status === "duplicate" || row.status === "unavailable";
}

/** Finished rows from the last 24 h that changed after the person last looked. */
export function unseenResults(
  rows: LinkQueueRow[],
  lastLooked: number,
  now = Date.now(),
): LinkQueueRow[] {
  return rows.filter((row) => {
    if (!isResultRow(row)) return false;
    const time = Date.parse(row.updated_at);
    return Number.isFinite(time) && now - time <= RESULT_WINDOW_MS && time > lastLooked;
  });
}

export function hasWorkToShow(rows: LinkQueueRow[], lastLooked: number, now = Date.now()): boolean {
  return (
    rows.some((row) => isOpenRow(row) || row.status === "failed") ||
    unseenResults(rows, lastLooked, now).length > 0
  );
}

/** Newest first, the order the panel lists them in. */
export function sortRecent(rows: LinkQueueRow[]): LinkQueueRow[] {
  return [...rows].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

/** Short text for the top-bar button: "1 needs you", "2 waiting", "3 saved". Null if nothing to say. */
export function formatPillSummary(
  rows: LinkQueueRow[],
  seen: LinkWorkersSeen | null,
  lastLooked: number,
  now = Date.now(),
): string | null {
  const live = rows.filter((row) => isOpenRow(row) || row.status === "failed");
  const summary = summarizeLinks(live, seen, now);
  if (summary.needsYou > 0) {
    return summary.needsYou === 1 ? "1 needs you" : `${summary.needsYou} need you`;
  }
  if (live.length > 0) return `${live.length} waiting`;
  const unseen = unseenResults(rows, lastLooked, now).length;
  if (unseen > 0) return unseen === 1 ? "1 saved" : `${unseen} saved`;
  return null;
}

/** The line at the top of the panel when something needs the person. */
export function panelNextStep(
  rows: LinkQueueRow[],
  seen: LinkWorkersSeen | null,
  now = Date.now(),
): string | null {
  const summary: LinkStatusSummary = summarizeLinks(
    rows.filter((row) => !["saved", "duplicate", "unavailable", "cancelled"].includes(row.status)),
    seen,
    now,
  );
  return summary.nextStep;
}

export interface ChromeSaved {
  count: number;
  /** Set when every one of them was added by the same person or assistant. */
  addedBy: string | null;
}

/**
 * Links Chrome (needs "browser") saved between two refreshes. `previous` maps id → status from
 * the refresh before; null on the first load, which announces nothing.
 */
export function detectChromeSaved(
  previous: ReadonlyMap<string, LinkQueueRow["status"]> | null,
  next: LinkQueueRow[],
): ChromeSaved | null {
  if (!previous) return null;
  const saved = next.filter((row) => {
    if (row.needs !== "browser" || row.status !== "saved") return false;
    const before = previous.get(row.id);
    return before !== undefined && before !== "saved";
  });
  if (saved.length === 0) return null;
  const names = new Set(saved.map((row) => row.added_by).filter(Boolean));
  return { count: saved.length, addedBy: names.size === 1 ? [...names][0] : null };
}

export function statusMap(rows: LinkQueueRow[]): Map<string, LinkQueueRow["status"]> {
  return new Map(rows.map((row) => [row.id, row.status]));
}

export function formatChromeSavedToast(saved: ChromeSaved): string {
  const noun = saved.count === 1 ? "link" : "links";
  return saved.addedBy
    ? `Chrome saved ${saved.count} ${noun} ${saved.addedBy} added`
    : `Chrome saved ${saved.count} ${noun}`;
}

/** The link's title, else its host and path. */
export function linkTitle(row: Pick<LinkQueueRow, "title" | "url">): string {
  const title = row.title?.trim();
  if (title) return title;
  try {
    const url = new URL(row.url);
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${url.host.replace(/^www\./, "")}${path}`;
  } catch {
    return row.url;
  }
}

/** "Project / Group / Subgroup" for a folder id; empty when the folder isn't known. */
export function groupPath(
  folders: ReadonlyArray<{ id: string; parent_id: string | null; name: string }>,
  folderId: string,
): string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const names: string[] = [];
  let current = byId.get(folderId);
  while (current && names.length < 50) {
    names.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return names.join(" / ");
}

export type RowAction = "open" | "retry" | "dismiss" | "cancel";

/** Which buttons a row gets. */
export function rowActions(row: LinkQueueRow, status: LinkStatus): RowAction[] {
  if (row.status === "saved" || row.status === "duplicate") {
    return row.item_id ? ["open"] : [];
  }
  if (row.status === "failed") return ["retry", "dismiss"];
  if (row.status === "waiting" || row.status === "working") {
    return status.state === "saving" ? [] : ["cancel"];
  }
  return [];
}

export { describeQueuedLink };
