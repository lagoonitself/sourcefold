import type { LinkQueueRow } from "@sourcefold/client";
import type { LinkWorkersSeen } from "@sourcefold/core";
import { remoteFetch } from "@/lib/remote-client";
import { BROWSER_MESSAGE } from "./copy";
import type { LinkQueuePatch } from "./types";

// The same local API `lib/api.ts` uses (`remoteFetch` → the in-webview route handlers).

export function claimDesktopQueue(body: {
  needs: "desktop";
  worker: string;
  limit: number;
}): Promise<LinkQueueRow[]> {
  return remoteFetch<LinkQueueRow[]>("/api/link-queue/claim", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patchLinkQueue(id: string, body: LinkQueuePatch): Promise<void> {
  await remoteFetch<LinkQueueRow>(`/api/link-queue/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function enqueueForBrowser(body: {
  folderId: string;
  urls: string[];
  addedBy: string;
}): Promise<void> {
  await remoteFetch<LinkQueueRow[]>("/api/link-queue", {
    method: "POST",
    body: JSON.stringify({
      folder_id: body.folderId,
      added_by: body.addedBy,
      links: body.urls.map((url) => ({ url, needs: "browser", message: BROWSER_MESSAGE })),
    }),
  });
}

/** Open rows the extension still has to save. */
export function listBrowserQueue(): Promise<LinkQueueRow[]> {
  return remoteFetch<LinkQueueRow[]>("/api/link-queue?status=open&needs=browser");
}

/** Rows from the last 7 days, open or finished (the "Links from Claude" panel). */
export function listRecentLinks(): Promise<LinkQueueRow[]> {
  return remoteFetch<LinkQueueRow[]>("/api/link-queue?status=recent");
}

/** When the desktop app and the extension last checked in. Throws on an older server. */
export function getLinkWorkers(): Promise<LinkWorkersSeen> {
  return remoteFetch<LinkWorkersSeen>("/api/link-queue/workers");
}

export async function checkInDesktop(worker: string, version: string | null): Promise<void> {
  await remoteFetch<unknown>("/api/link-queue/workers", {
    method: "POST",
    body: JSON.stringify({
      worker,
      kind: "desktop",
      can_run: true,
      ...(version ? { version: version.slice(0, 40) } : {}),
    }),
  });
}

/** Cancels a waiting link, or dismisses a failed one. */
export async function deleteLinkQueueRow(id: string): Promise<void> {
  await remoteFetch<unknown>(`/api/link-queue/${encodeURIComponent(id)}`, { method: "DELETE" });
}
