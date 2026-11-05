// Moves text and images that still sit in Supabase to R2 through the content Worker, and (while
// Drive is connected) the owner's older sources whose only copy is in Drive. The database then
// decides when to clear `items.markdown` (`mark_item_content_stored`).
import type { SupabaseClient } from "@supabase/supabase-js";
import { bodyFromDriveFile } from "@sourcefold/core";
import type { Database } from "../../database.types";
import { downloadFileBytes, downloadFileText } from "../../google/drive";
import { DriveAuthError } from "../../google/errors";
import type { Host } from "../../host";
import { ContentStoreError } from "./worker-store";

export interface ContentBatchFailedItem {
  id: string;
  title: string;
  message: string;
}

export interface ContentBatchResult {
  moved: number;
  failed: ContentBatchFailedItem[];
  /** R2's free plan is full; nothing more is moved until space is freed. */
  storageFull: boolean;
}

/** Same spirit as the Drive batch: stop starting new items after this long. */
const TIME_BUDGET_MS = 40_000;

type ItemRow = Database["public"]["Tables"]["items"]["Row"];

function mimeTypeOf(item: ItemRow, fallback: string | null): string {
  const meta = (item.meta ?? {}) as Record<string, unknown>;
  return typeof meta.mime_type === "string"
    ? meta.mime_type
    : fallback || "application/octet-stream";
}

export async function runContentBatch(
  db: SupabaseClient<Database>,
  userId: string,
  host: Pick<Host, "drive" | "content">,
  budget = 20,
): Promise<ContentBatchResult> {
  const result: ContentBatchResult = { moved: 0, failed: [], storageFull: false };
  const store = host.content;
  if (!store) return result;

  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt >= TIME_BUDGET_MS;
  let used = 0;

  /** Runs one item; false when the batch must stop. */
  async function attempt(item: ItemRow, move: () => Promise<void>): Promise<boolean> {
    used++;
    try {
      await move();
      result.moved++;
      return true;
    } catch (err) {
      if (err instanceof ContentStoreError) {
        if (err.status === 401) throw err;
        if (err.code === "storage_full") {
          result.storageFull = true;
          return false;
        }
      }
      result.failed.push({
        id: item.id,
        title: item.title,
        message: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof DriveAuthError) {
        host.drive.clearAccessToken(userId);
        return false;
      }
      return true;
    }
  }

  async function mark(item: ItemRow, stored: { sha256: string; bytes: number }): Promise<boolean> {
    const { data, error } = await db.rpc("mark_item_content_stored", {
      p_id: item.id,
      p_seen_updated_at: item.updated_at,
      p_sha256: stored.sha256,
      p_bytes: stored.bytes,
      p_user_id: userId,
    });
    if (error) throw new Error(error.message);
    return Boolean(data);
  }

  // (a) Text and images that never left Supabase.
  const { data: waiting, error: waitingError } = await db.rpc("content_waiting_items", {
    p_limit: budget,
    p_user_id: userId,
  });
  if (waitingError) throw new Error(waitingError.message);

  for (const item of waiting ?? []) {
    if (used >= budget || outOfTime() || result.storageFull) break;
    const goOn = await attempt(item, async () => {
      if (item.kind === "image") {
        if (!item.storage_path) throw new Error("This image has no file to move.");
        const { data: blob, error } = await db.storage.from("images").download(item.storage_path);
        if (error || !blob) throw new Error(error?.message || "Image download failed.");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const stored = await store.putFile(item.id, bytes, mimeTypeOf(item, blob.type));
        if ((await mark(item, stored)) && item.storage_path) {
          await db.storage.from("images").remove([item.storage_path]);
        }
        return;
      }
      await mark(item, await store.putText(item.id, item.markdown ?? ""));
    });
    if (!goOn) break;
  }
  if (result.storageFull) return result;

  // (b) The owner's older sources whose only copy is in Drive.
  if (used < budget && !outOfTime() && (await host.drive.isConnected(userId))) {
    const { data: driveOnly, error: driveOnlyError } = await db.rpc("content_drive_only_items", {
      p_limit: budget - used,
      p_user_id: userId,
    });
    if (driveOnlyError) throw new Error(driveOnlyError.message);

    for (const item of driveOnly ?? []) {
      if (used >= budget || outOfTime() || result.storageFull) break;
      const goOn = await attempt(item, async () => {
        if (!item.drive_file_id) throw new Error("This source has no Drive file to read.");
        const token = await host.drive.getAccessToken(userId);
        if (item.kind === "image") {
          const bytes = await downloadFileBytes(token, item.drive_file_id);
          if (!bytes) throw new Error("Its Drive file was deleted, and Drive held the only copy.");
          await mark(item, await store.putFile(item.id, bytes, mimeTypeOf(item, null)));
          return;
        }
        const text = await downloadFileText(token, item.drive_file_id);
        if (text === null) {
          throw new Error("Its Drive file was deleted, and Drive held the only copy.");
        }
        await mark(item, await store.putText(item.id, bodyFromDriveFile(text)));
      });
      if (!goOn) break;
    }
  }

  return result;
}
