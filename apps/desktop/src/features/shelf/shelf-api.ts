import type { ShelfAddResult, ShelfLink, ShelfLinkInput, ShelfLinkPatch } from "@sourcefold/core";
import { shouldUseTauri } from "@/lib/api";
import { isRemoteConfigured, remoteFetch } from "@/lib/remote-client";
import { errorMessage } from "@/lib/utils";

// The Link Shelf (docs/dev/PLAN-shelf.md). Storage follows the app's mode, as TL;DRs do: offline
// the SQLite table through Rust (`list_shelf` and friends), signed in `/api/shelf` in the local API.

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw new Error(errorMessage(err, "The shelf couldn't be reached. Try again."));
  }
}

export async function listShelf(): Promise<ShelfLink[]> {
  if (shouldUseTauri()) {
    return await tauriInvoke<ShelfLink[]>("list_shelf");
  }
  if (!isRemoteConfigured()) return [];
  return await remoteFetch<ShelfLink[]>("/api/shelf");
}

export async function addShelfLinks(inputs: ShelfLinkInput[]): Promise<ShelfAddResult> {
  if (shouldUseTauri()) {
    return await tauriInvoke<ShelfAddResult>("add_shelf_links", { links: inputs });
  }
  return await remoteFetch<ShelfAddResult>("/api/shelf", {
    method: "POST",
    body: JSON.stringify({ links: inputs }),
  });
}

export async function updateShelfLink(id: string, patch: ShelfLinkPatch): Promise<ShelfLink> {
  if (shouldUseTauri()) {
    return await tauriInvoke<ShelfLink>("update_shelf_link", { id, patch });
  }
  return await remoteFetch<ShelfLink>(`/api/shelf/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteShelfLink(id: string): Promise<void> {
  if (shouldUseTauri()) {
    await tauriInvoke<null>("delete_shelf_link", { id });
    return;
  }
  await remoteFetch<unknown>(`/api/shelf/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function recordShelfOpen(id: string): Promise<ShelfLink> {
  if (shouldUseTauri()) {
    return await tauriInvoke<ShelfLink>("open_shelf_link", { id });
  }
  return await remoteFetch<ShelfLink>(`/api/shelf/${encodeURIComponent(id)}/open`, {
    method: "POST",
  });
}
