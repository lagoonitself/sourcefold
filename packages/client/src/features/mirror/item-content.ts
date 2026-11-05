import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import { exportFile, getFile, listChildren } from "../../google/drive";
import type { DriveAccess, Host } from "../../host";
import {
  ContentGoneError,
  ContentNotReadyError,
  loadItemBody,
  loadItemFile,
} from "../content/body";
import { buildItemFile, folderPathOf, type FolderRef } from "../drive/build-file";
import { loadHighlightsForItems } from "../highlights/load";
import { GOOGLE_DOC_MIME, googleDocName } from "../drive/google-doc-sync";

export type ItemContent =
  | { ok: true; body: string | Uint8Array; mimeType: string }
  | { ok: false; status: 404 | 409; message: string; code?: "not_ready" };

const NOT_FOUND: ItemContent = { ok: false, status: 404, message: "Item not found." };
const NOT_READY = (err: Error): ItemContent => ({
  ok: false,
  status: 409,
  message: err.message,
  code: "not_ready",
});
const DRIVE_COPY_GONE: ItemContent = {
  ok: false,
  status: 409,
  message: "Its Drive file was deleted, and Drive held the only copy.",
};

/**
 * The item's file exactly as Drive holds it (docs/FILE-FORMAT.md), built fresh from the current
 * title, note and folder path. Text that already moved out of the database is read back from
 * R2 (or, for older sources, the owner's Drive).
 */
export async function getItemContent(
  db: SupabaseClient<Database>,
  userId: string,
  itemId: string,
  host: Pick<Host, "drive" | "content">,
): Promise<ItemContent> {
  const { data: item, error } = await db
    .from("items")
    .select(
      "id, folder_id, kind, title, status, source_url, canonical_url, created_at, markdown, meta, note, storage_path, drive_file_id, content_sha256, user_id",
    )
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!item || item.status !== "saved") return NOT_FOUND;

  if (item.kind === "image") {
    const meta = (item.meta ?? {}) as Record<string, unknown>;
    const mimeType =
      typeof meta.mime_type === "string" ? meta.mime_type : "application/octet-stream";
    try {
      const file = await loadItemFile(db, host, userId, item);
      return file ? { ok: true, body: file.bytes, mimeType } : DRIVE_COPY_GONE;
    } catch (err) {
      if (err instanceof ContentNotReadyError) return NOT_READY(err);
      throw err;
    }
  }

  let markdown: string;
  try {
    markdown = await loadItemBody(db, host, userId, item);
  } catch (err) {
    if (err instanceof ContentGoneError) return DRIVE_COPY_GONE;
    if (err instanceof ContentNotReadyError) return NOT_READY(err);
    throw err;
  }

  const { data: folders, error: foldersError } = await db
    .from("folders")
    .select("id, parent_id, name")
    .is("deleted_at", null);
  if (foldersError) throw new Error(foldersError.message);
  const foldersById = new Map<string, FolderRef>((folders ?? []).map((f) => [f.id, f]));

  const highlights = (await loadHighlightsForItems(db, userId, [item.id])).get(item.id) ?? [];

  return {
    ok: true,
    body: buildItemFile(
      { ...item, markdown, highlights },
      folderPathOf(item.folder_id, foldersById),
    ),
    mimeType: "text/markdown; charset=utf-8",
  };
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const DOCX_NOT_READY: ItemContent = {
  ok: false,
  status: 404,
  message: "Its Google Doc isn't in Drive yet. Press Save to Drive, then try again.",
  code: "not_ready",
};

/**
 * The item's Google Doc exported as .docx. The Doc is made when the file is pushed to Drive, so
 * until then (or if it was deleted there) the answer is `not_ready`, and the caller tries later.
 */
export async function getItemDocx(
  db: SupabaseClient<Database>,
  userId: string,
  itemId: string,
  drive: DriveAccess,
): Promise<ItemContent> {
  const { data: item, error } = await db
    .from("items")
    .select("id, kind, status, drive_file_id, user_id")
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!item || item.status !== "saved" || item.kind === "image") return NOT_FOUND;
  // The Google Doc sits in the owner's Drive; other members can't reach it.
  if (!item.drive_file_id || item.user_id !== userId) return DOCX_NOT_READY;

  const token = await drive.getAccessToken(userId);
  // The Doc sits next to the Markdown file and has its name without `.md`.
  const file = await getFile(token, item.drive_file_id);
  const parentId = file?.parents[0];
  if (!file || file.trashed || !file.name || !parentId) return DOCX_NOT_READY;
  const docs = await listChildren(token, parentId, {
    name: googleDocName(file.name),
    mimeType: GOOGLE_DOC_MIME,
  });
  if (docs.length === 0) return DOCX_NOT_READY;

  const bytes = await exportFile(token, docs[0]!.id, DOCX_MIME);
  return bytes ? { ok: true, body: bytes, mimeType: DOCX_MIME } : DOCX_NOT_READY;
}
