import { apiFetchAccount } from "../api";
import type { LinkWorkersSeen } from "@sourcefold/core";
import type { LinkQueuePatch, LinkQueueRow } from "./types";

function asRows(value: unknown): LinkQueueRow[] {
  return Array.isArray(value) ? (value as LinkQueueRow[]) : [];
}

/**
 * Claims a few rows, oldest first, and opens them one at a time. More than one, so a link for a
 * site the user hasn't allowed yet (released and claimed first every time) can't hold up the rest.
 */
export const BROWSER_CLAIM_LIMIT = 5;

export async function claimBrowserRow(worker: string): Promise<LinkQueueRow[]> {
  const rows = await apiFetchAccount<unknown>("/api/link-queue/claim", {
    method: "POST",
    body: JSON.stringify({ needs: "browser", worker, limit: BROWSER_CLAIM_LIMIT }),
  });
  return asRows(rows);
}

export async function patchLinkQueue(id: string, body: LinkQueuePatch): Promise<void> {
  await apiFetchAccount<unknown>(`/api/link-queue/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function listLinkQueue(status: "open" | "recent"): Promise<LinkQueueRow[]> {
  const rows = await apiFetchAccount<unknown>(
    `/api/link-queue?status=${status}&needs=browser&limit=200`,
  );
  return asRows(rows);
}

/** Every recent row (last seven days), whichever helper handles it. */
export async function listRecentAll(): Promise<LinkQueueRow[]> {
  return asRows(await apiFetchAccount<unknown>("/api/link-queue?status=recent&limit=200"));
}

export async function fetchLinkWorkers(): Promise<LinkWorkersSeen> {
  return apiFetchAccount<LinkWorkersSeen>("/api/link-queue/workers");
}

export async function postLinkCheckIn(body: {
  worker: string;
  kind: "extension";
  can_run: boolean;
  version: string;
}): Promise<void> {
  await apiFetchAccount<unknown>("/api/link-queue/workers", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Dismiss: the server sets a failed row to cancelled. */
export async function dismissLinkQueueRow(id: string): Promise<void> {
  await apiFetchAccount<unknown>(`/api/link-queue/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
