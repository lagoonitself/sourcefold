import type { LinkQueueRow } from "@sourcefold/client";
import { remoteFetch } from "@/lib/remote-client";
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

/** Open rows the extension still has to save. */
export function listBrowserQueue(): Promise<LinkQueueRow[]> {
  return remoteFetch<LinkQueueRow[]>("/api/link-queue?status=open&needs=browser");
}
