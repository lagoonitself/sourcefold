import {
  describeQueuedLink,
  summarizeLinks,
  type LinkStatus,
  type LinkWorkersSeen,
} from "@sourcefold/core";
import { hostOf } from "./copy";
import type { LinkQueueRow } from "./types";

/** The popup lists links from the last seven days, at most this many. */
export const LINK_LIST_LIMIT = 20;
export const LINK_LIST_DAYS = 7;

/** The extension can work the queue when it is signed in and reaches the desktop app. */
export function canRunQueue(signedIn: boolean, desktopReachable: boolean): boolean {
  return signedIn && desktopReachable;
}

export function checkInBody(worker: string, canRun: boolean, version: string) {
  return { worker, kind: "extension" as const, can_run: canRun, version };
}

/** Links that need the person: shown as the orange count on the toolbar icon. */
export function needsYouCount(
  rows: LinkQueueRow[],
  seen: LinkWorkersSeen | null,
  now = Date.now(),
): number {
  return rows.filter((row) => describeQueuedLink(row, seen, now).needsYou).length;
}

export function badgeText(count: number): string {
  if (count <= 0) return "";
  return count > 9 ? "9+" : String(count);
}

/** Toolbar tooltip: the one next step when something needs the person. */
export function badgeTitle(
  rows: LinkQueueRow[],
  seen: LinkWorkersSeen | null,
  now = Date.now(),
): string {
  const summary = summarizeLinks(rows, seen, now);
  if (summary.needsYou === 0) return "Sourcefold";
  const noun = summary.needsYou === 1 ? "link needs" : "links need";
  return `${summary.needsYou} ${noun} you. ${summary.nextStep ?? ""}`.trim();
}

/** Newest first, last seven days, up to 20. */
export function listRows(rows: LinkQueueRow[], now = Date.now()): LinkQueueRow[] {
  const cutoff = now - LINK_LIST_DAYS * 24 * 60 * 60 * 1000;
  return rows
    .filter((row) => {
      const time = Date.parse(row.created_at);
      return !Number.isFinite(time) || time >= cutoff;
    })
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, LINK_LIST_LIMIT);
}

/** The saved title, or the address without `https://`. */
export function rowTitle(row: Pick<LinkQueueRow, "title" | "url">): string {
  const title = row.title?.trim();
  if (title) return title;
  try {
    const url = new URL(row.url);
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${hostOf(row.url) || url.host}${path}`;
  } catch {
    return row.url;
  }
}

export interface LinkRowView {
  row: LinkQueueRow;
  title: string;
  status: LinkStatus;
  allow: boolean;
  retry: boolean;
  dismiss: boolean;
}

export function viewRows(
  rows: LinkQueueRow[],
  seen: LinkWorkersSeen | null,
  now = Date.now(),
): LinkRowView[] {
  return listRows(rows, now).map((row) => {
    const status = describeQueuedLink(row, seen, now);
    return {
      row,
      title: rowTitle(row),
      status,
      allow: status.state === "needs_allow",
      retry: status.state === "failed" || status.state === "needs_sign_in",
      dismiss: status.state === "failed",
    };
  });
}
