import type { LinkQueueRow } from "@sourcefold/client";
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
