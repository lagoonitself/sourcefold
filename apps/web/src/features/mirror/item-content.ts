import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bodyFromDriveFile } from "@sourcefold/core";
import type { Database } from "@/lib/database.types";
import { downloadFileBytes, downloadFileText } from "@/lib/google/drive";
import { getGoogleAccessToken } from "@/lib/google/oauth";
import { buildItemFile, folderPathOf, type FolderRef } from "@/features/drive/build-file";

export type ItemContent =
  | { ok: true; body: string | Uint8Array; mimeType: string }
  | { ok: false; status: 404 | 409; message: string };

const NOT_FOUND: ItemContent = { ok: false, status: 404, message: "Item not found." };
const DRIVE_COPY_GONE: ItemContent = {
  ok: false,
  status: 409,
  message: "Its Drive file was deleted, and Drive held the only copy.",
};

/**
 * The item's file exactly as Drive holds it (docs/FILE-FORMAT.md), built fresh from the current
 * title, note and folder path. Text that already moved to Drive is read back from Drive.
 */
export async function getItemContent(
  db: SupabaseClient<Database>,
  userId: string,
  itemId: string,
): Promise<ItemContent> {
  const { data: item, error } = await db
    .from("items")
    .select(
      "id, folder_id, kind, title, status, source_url, canonical_url, created_at, markdown, meta, note, storage_path, drive_file_id",
    )
    .eq("id", itemId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!item || item.status !== "saved") return NOT_FOUND;

  if (item.kind === "image") {
    const meta = (item.meta ?? {}) as Record<string, unknown>;
    const mimeType =
      typeof meta.mime_type === "string" ? meta.mime_type : "application/octet-stream";
    if (item.storage_path) {
      const { data: blob, error: downloadError } = await db.storage
        .from("images")
        .download(item.storage_path);
      if (downloadError || !blob)
        throw new Error(downloadError?.message || "Image download failed.");
      return { ok: true, body: new Uint8Array(await blob.arrayBuffer()), mimeType };
    }
    if (!item.drive_file_id) return DRIVE_COPY_GONE;
    const bytes = await downloadFileBytes(await getGoogleAccessToken(userId), item.drive_file_id);
    return bytes ? { ok: true, body: bytes, mimeType } : DRIVE_COPY_GONE;
  }

  let markdown = item.markdown;
  if (markdown === null && item.kind !== "note") {
    if (!item.drive_file_id) return DRIVE_COPY_GONE;
    const text = await downloadFileText(await getGoogleAccessToken(userId), item.drive_file_id);
    if (text === null) return DRIVE_COPY_GONE;
    markdown = bodyFromDriveFile(text);
  }

  const { data: folders, error: foldersError } = await db
    .from("folders")
    .select("id, parent_id, name")
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (foldersError) throw new Error(foldersError.message);
  const foldersById = new Map<string, FolderRef>((folders ?? []).map((f) => [f.id, f]));

  return {
    ok: true,
    body: buildItemFile({ ...item, markdown }, folderPathOf(item.folder_id, foldersById)),
    mimeType: "text/markdown; charset=utf-8",
  };
}
