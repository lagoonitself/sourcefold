import type { SupabaseClient } from "@supabase/supabase-js";
import { projectFileMediaType } from "@sourcefold/core/project-file";
import type { Database } from "../../database.types";
import { findPostImagesFolder } from "../drive/post-images";
import { getFile } from "../../google/drive";
import type { DriveAccess } from "../../host";

// The images and GIFs of a post, kept in `<file name>_files/` next to its file in Drive
// (docs/FILE-FORMAT.md, "Post images"). Project files carry them; bigger ones stay out.

export const MAX_MEDIA_BYTES = 4 * 1024 * 1024;

export interface MediaFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
}

export type ItemMedia =
  { ok: true; token: string; files: MediaFile[] } | { ok: false; status: 404; message: string };

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** A name that stays inside the folder: no separators, no `..`, no control characters. */
export function isSafeMediaName(name: string): boolean {
  if (name.length === 0 || name.length > 300 || /[\u0000-\u001f\u007f]/.test(name)) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  return name !== "." && !name.includes("..");
}

async function listFolderFiles(token: string, folderId: string): Promise<MediaFile[]> {
  const files: MediaFile[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    const parent = folderId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    url.searchParams.set("q", `'${parent}' in parents and trashed = false`);
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size)");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Google Drive error (${res.status})`);
    const data = (await res.json()) as {
      nextPageToken?: string;
      files?: { id: string; name: string; mimeType: string; size?: string }[];
    };
    for (const f of data.files ?? []) {
      if (f.mimeType === FOLDER_MIME || !isSafeMediaName(f.name)) continue;
      files.push({
        id: f.id,
        name: f.name,
        size: Number(f.size ?? 0) || 0,
        mimeType: projectFileMediaType(f.name) ?? f.mimeType,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The files in the item's `_files` folder in the user's Drive. An item that isn't in Drive yet,
 * or has no such folder, has none. A missing item (or another user's) is a 404.
 */
export async function loadItemMedia(
  db: SupabaseClient<Database>,
  userId: string,
  itemId: string,
  drive: DriveAccess,
): Promise<ItemMedia> {
  const { data: item, error } = await db
    .from("items")
    .select("id, drive_file_id")
    .eq("id", itemId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!item) return { ok: false, status: 404, message: "Item not found." };
  if (!item.drive_file_id) return { ok: true, token: "", files: [] };

  const token = await drive.getAccessToken(userId);
  const file = await getFile(token, item.drive_file_id);
  const parentId = file?.parents[0];
  if (!file || file.trashed || !file.name || !parentId) return { ok: true, token, files: [] };

  const { data: folders, error: foldersError } = await db
    .from("folders")
    .select("drive_folder_id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .not("drive_folder_id", "is", null);
  if (foldersError) throw new Error(foldersError.message);
  const groupFolderIds = new Set((folders ?? []).map((f) => f.drive_folder_id!));

  const folderId = await findPostImagesFolder(
    token,
    { parentId, fileName: file.name },
    groupFolderIds,
  );
  if (!folderId) return { ok: true, token, files: [] };
  return { ok: true, token, files: await listFolderFiles(token, folderId) };
}
