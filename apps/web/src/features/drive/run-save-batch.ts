import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { bodyFromDriveFile, safeName } from "@sourcefold/core";
import {
  createFolder,
  downloadFileText,
  getFile,
  updateFile,
  uploadFile,
  DriveApiError,
} from "@/lib/google/drive";
import { clearGoogleAccessToken, DriveAuthError } from "@/lib/google/oauth";
import {
  buildItemFile,
  driveFileName,
  folderPathOf,
  itemExtension,
  type FolderRef,
  type SiblingRef,
} from "./build-file";
import { syncGoogleDoc, trashGoogleDoc } from "./google-doc-sync";
import { syncPostImages, trashPostImages } from "./post-images";

export interface SaveBatchFailedItem {
  id: string;
  title: string;
  message: string;
}

export interface SaveBatchResult {
  processed: number;
  remaining: number;
  done: boolean;
  failed: SaveBatchFailedItem[];
}

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  drive_folder_id: string | null;
  deleted_at: string | null;
}

function computeFolderDepths(folders: Map<string, FolderRow>): Map<string, number> {
  const depths = new Map<string, number>();

  for (const [id, folder] of folders.entries()) {
    let depth = 0;
    let curr = folder.parent_id;
    const visited = new Set<string>([id]);
    while (curr) {
      if (visited.has(curr)) break;
      visited.add(curr);
      depth++;
      const parent = folders.get(curr);
      curr = parent?.parent_id ?? null;
    }
    depths.set(id, depth);
  }

  return depths;
}

function getFolderAndDescendantIds(
  folderId: string,
  allFolders: { id: string; parent_id: string | null }[],
): string[] {
  const result: string[] = [folderId];
  const childrenMap = new Map<string, string[]>();
  for (const f of allFolders) {
    if (f.parent_id) {
      const list = childrenMap.get(f.parent_id) ?? [];
      list.push(f.id);
      childrenMap.set(f.parent_id, list);
    }
  }

  const queue = [folderId];
  const visited = new Set<string>([folderId]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childrenMap.get(current) ?? [];
    for (const childId of children) {
      if (!visited.has(childId)) {
        visited.add(childId);
        result.push(childId);
        queue.push(childId);
      }
    }
  }

  return result;
}

const DRIVE_COPY_GONE =
  "Its Drive file was deleted, and Drive held the only copy. Delete this item and add it again.";

async function readBodyFromDrive(accessToken: string, driveFileId: string | null): Promise<string> {
  const text = driveFileId ? await downloadFileText(accessToken, driveFileId) : null;
  if (text === null) {
    throw new Error(DRIVE_COPY_GONE);
  }
  return bodyFromDriveFile(text);
}

function isTransientError(err: unknown): boolean {
  if (err instanceof TypeError) {
    return true;
  }
  if (err instanceof DriveApiError) {
    if ([429, 500, 502, 503, 504].includes(err.status)) {
      return true;
    }
    if (err.status === 403) {
      const msg = err.message || "";
      if (msg.includes("rateLimitExceeded") || msg.includes("userRateLimitExceeded")) {
        return true;
      }
    }
  }
  return false;
}

async function trashDriveFile(accessToken: string, fileId: string, userId: string): Promise<void> {
  try {
    await updateFile(accessToken, fileId, { trashed: true });
  } catch (err) {
    if (err instanceof DriveAuthError) {
      clearGoogleAccessToken(userId);
      throw err;
    }
    if (err instanceof DriveApiError && err.status === 401) {
      clearGoogleAccessToken(userId);
      throw new DriveAuthError(err.message);
    }
    if (
      err instanceof DriveApiError &&
      (err.status === 404 || err.status === 400 || err.status === 403)
    ) {
      const file = await getFile(accessToken, fileId);
      if (!file || file.trashed || file.explicitlyTrashed) {
        return;
      }
      throw err;
    }
    throw err;
  }
}

export async function runSaveBatch(
  supabase: SupabaseClient<Database>,
  userId: string,
  accessToken: string,
  budget = 20,
): Promise<SaveBatchResult> {
  const batchStartTime = Date.now();
  const isTimeExpired = () => Date.now() - batchStartTime >= 45_000;

  let remainingBudget = budget;
  let processed = 0;
  const failed: SaveBatchFailedItem[] = [];

  // 1. Root folder
  const { data: driveState, error: stateError } = await supabase
    .from("drive_state")
    .select("root_folder_id, last_saved_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (stateError) {
    throw new Error(stateError.message);
  }

  let rootFolderId = driveState?.root_folder_id ?? null;
  if (rootFolderId) {
    const existingRoot = await getFile(accessToken, rootFolderId);
    if (!existingRoot || existingRoot.trashed) {
      rootFolderId = null;
    }
  }

  if (!rootFolderId) {
    const hadRoot = Boolean(driveState?.root_folder_id);
    const createdRoot = await createFolder(accessToken, "Sourcefold", "root");
    rootFolderId = createdRoot.id;
    await supabase.from("drive_state").upsert(
      {
        user_id: userId,
        root_folder_id: rootFolderId,
      },
      { onConflict: "user_id" },
    );
    if (hadRoot) {
      // The old root was deleted in Drive, taking every folder and file with it.
      await supabase
        .from("folders")
        .update({ drive_synced_at: null })
        .eq("user_id", userId)
        .is("deleted_at", null);
      await supabase
        .from("items")
        .update({ drive_synced_at: null })
        .eq("user_id", userId)
        .is("deleted_at", null);
    }
    remainingBudget--;
    processed++;
  }

  // 2. Folders
  const { data: allFoldersData, error: allFoldersError } = await supabase
    .from("folders")
    .select("id, parent_id, name, drive_folder_id, deleted_at")
    .eq("user_id", userId);

  if (allFoldersError || !allFoldersData) {
    throw new Error(allFoldersError?.message || "Failed to load folders");
  }

  const foldersById = new Map<string, FolderRow>();
  for (const f of allFoldersData) {
    foldersById.set(f.id, { ...f });
  }

  const { data: dirtyFolders, error: dirtyFoldersError } = await supabase.rpc(
    "drive_dirty_folders",
    { p_user_id: userId },
  );
  if (dirtyFoldersError || !dirtyFolders) {
    throw new Error(dirtyFoldersError?.message || "Failed to get dirty folders");
  }

  const depths = computeFolderDepths(foldersById);
  const liveDirtyFolders = dirtyFolders
    .filter((f) => f.deleted_at === null)
    .sort((a, b) => (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0));
  const deletedDirtyFolders = dirtyFolders.filter((f) => f.deleted_at !== null);

  for (const folder of liveDirtyFolders) {
    if (remainingBudget <= 0) break;

    let parentDriveId: string;
    if (folder.parent_id === null) {
      parentDriveId = rootFolderId;
    } else {
      const parentRow = foldersById.get(folder.parent_id);
      if (!parentRow?.drive_folder_id) {
        continue;
      }
      parentDriveId = parentRow.drive_folder_id;
    }

    if (!folder.drive_folder_id) {
      const created = await createFolder(accessToken, safeName(folder.name), parentDriveId);
      const folderRef = foldersById.get(folder.id);
      if (folderRef) folderRef.drive_folder_id = created.id;

      await supabase.rpc("mark_folder_synced", {
        p_id: folder.id,
        p_drive_folder_id: created.id,
      });
      processed++;
      remainingBudget--;
    } else {
      const existing = await getFile(accessToken, folder.drive_folder_id);
      if (!existing || existing.trashed) {
        const created = await createFolder(accessToken, safeName(folder.name), parentDriveId);
        const folderRef = foldersById.get(folder.id);
        if (folderRef) folderRef.drive_folder_id = created.id;

        // Its old Drive copy is gone, so everything inside must be uploaded again.
        const subtreeIds = getFolderAndDescendantIds(folder.id, allFoldersData);
        const childFolderIds = subtreeIds.filter((id) => id !== folder.id);
        if (childFolderIds.length > 0) {
          await supabase
            .from("folders")
            .update({ drive_synced_at: null })
            .in("id", childFolderIds)
            .eq("user_id", userId)
            .is("deleted_at", null);
        }
        await supabase
          .from("items")
          .update({ drive_synced_at: null })
          .in("folder_id", subtreeIds)
          .eq("user_id", userId)
          .is("deleted_at", null);

        await supabase.rpc("mark_folder_synced", {
          p_id: folder.id,
          p_drive_folder_id: created.id,
        });
        processed++;
        remainingBudget--;
      } else {
        let addParents: string | undefined;
        let removeParents: string | undefined;
        if (!existing.parents?.includes(parentDriveId)) {
          addParents = parentDriveId;
          removeParents = existing.parents?.join(",");
        }

        await updateFile(accessToken, folder.drive_folder_id, {
          name: safeName(folder.name),
          addParents,
          removeParents,
        });

        await supabase.rpc("mark_folder_synced", {
          p_id: folder.id,
          p_drive_folder_id: folder.drive_folder_id,
        });
        processed++;
        remainingBudget--;
      }
    }
  }

  for (const folder of deletedDirtyFolders) {
    if (remainingBudget <= 0) break;
    if (folder.drive_folder_id) {
      await trashDriveFile(accessToken, folder.drive_folder_id, userId);

      await supabase
        .from("folders")
        .update({ drive_folder_id: null })
        .eq("id", folder.id)
        .eq("user_id", userId);

      const folderRef = foldersById.get(folder.id);
      if (folderRef) folderRef.drive_folder_id = null;
      processed++;
      remainingBudget--;
    }
  }

  // 3. Items
  if (remainingBudget > 0 && !isTimeExpired()) {
    const { data: dirtyItems, error: dirtyItemsError } = await supabase.rpc("drive_dirty_items", {
      p_limit: remainingBudget,
      p_user_id: userId,
    });

    if (dirtyItemsError) {
      throw new Error(dirtyItemsError.message);
    }

    const folderItemsCache = new Map<
      string,
      Promise<{ id: string; title: string; kind: string; meta: Json; created_at: string }[]>
    >();

    const getFolderSiblings = (folderId: string) => {
      let promise = folderItemsCache.get(folderId);
      if (!promise) {
        promise = (async () => {
          const { data, error } = await supabase
            .from("items")
            .select("id, title, kind, meta, created_at")
            .eq("folder_id", folderId)
            .eq("user_id", userId)
            .is("deleted_at", null);
          if (error || !data) return [];
          return data;
        })();
        folderItemsCache.set(folderId, promise);
      }
      return promise;
    };

    const itemsToProcess = dirtyItems ?? [];
    const groupFolderIds = new Set(
      [...foldersById.values()]
        .map((f) => f.drive_folder_id)
        .filter((id): id is string => Boolean(id)),
    );

    const processItem = async (item: (typeof itemsToProcess)[number]) => {
      try {
        if (item.deleted_at !== null) {
          if (item.drive_file_id) {
            if (item.kind !== "image") {
              const file = await getFile(accessToken, item.drive_file_id);
              if (file?.name && file.parents[0]) {
                const spot = { parentId: file.parents[0], fileName: file.name };
                await trashPostImages(accessToken, spot, groupFolderIds);
                await trashGoogleDoc(accessToken, spot);
              }
            }
            await trashDriveFile(accessToken, item.drive_file_id, userId);

            await supabase
              .from("items")
              .update({ drive_file_id: null })
              .eq("id", item.id)
              .eq("user_id", userId);

            processed++;
            remainingBudget--;
          }
          return;
        }

        const targetParentDriveId = foldersById.get(item.folder_id)?.drive_folder_id;
        if (!targetParentDriveId) {
          return;
        }

        const siblings = await getFolderSiblings(item.folder_id);
        const siblingRefs: SiblingRef[] = siblings;

        const meta =
          typeof item.meta === "object" && item.meta !== null
            ? (item.meta as Record<string, unknown>)
            : {};
        let fileName: string;
        let mimeType: string;
        // null: the content already lives only in Drive and hasn't changed, so only rename or move it.
        let body: string | Uint8Array | null;

        if (item.kind === "image") {
          mimeType = (meta.mime_type as string) || "application/octet-stream";
          fileName = driveFileName(
            item.title,
            item.id,
            siblingRefs,
            itemExtension("image", meta),
            item.created_at,
          );

          if (item.storage_path) {
            const { data: blob, error: downloadError } = await supabase.storage
              .from("images")
              .download(item.storage_path);
            if (downloadError || !blob) {
              throw new Error(downloadError?.message || "Failed to download image from storage");
            }
            body = new Uint8Array(await blob.arrayBuffer());
          } else if (item.drive_file_id) {
            body = null;
          } else {
            throw new Error(DRIVE_COPY_GONE);
          }
        } else {
          mimeType = "text/markdown";
          fileName = driveFileName(item.title, item.id, siblingRefs, "md", item.created_at);
          const folderPath = folderPathOf(item.folder_id, foldersById as Map<string, FolderRef>);
          let markdown = item.markdown;
          if (markdown === null && item.kind !== "note") {
            markdown = await readBodyFromDrive(accessToken, item.drive_file_id);
          }
          body = buildItemFile({ ...item, markdown }, folderPath);
        }

        const existing = item.drive_file_id ? await getFile(accessToken, item.drive_file_id) : null;
        let driveFileId: string;

        // A trashed file is restored only when Drive holds the only copy (body is null).
        if (existing && (!existing.trashed || body === null)) {
          const moving = !existing.parents?.includes(targetParentDriveId);
          const addParents = moving ? targetParentDriveId : undefined;
          const removeParents = moving ? existing.parents?.join(",") : undefined;

          if (body === null) {
            await updateFile(accessToken, existing.id, {
              name: fileName,
              addParents,
              removeParents,
              trashed: existing.trashed ? false : undefined,
            });
          } else {
            await uploadFile(accessToken, {
              id: existing.id,
              name: fileName,
              mimeType,
              body,
              addParents,
              removeParents,
            });
          }
          driveFileId = existing.id;
        } else {
          if (body === null) {
            throw new Error(DRIVE_COPY_GONE);
          }
          const created = await uploadFile(accessToken, {
            name: fileName,
            parentId: targetParentDriveId,
            mimeType,
            body,
          });
          driveFileId = created.id;
        }

        // A copy of the post's images and a Google Doc next to it. Before marking it saved, so a
        // failed upload is tried again on the next save.
        if (typeof body === "string") {
          const previous =
            existing?.name && existing.parents?.[0]
              ? { parentId: existing.parents[0], fileName: existing.name }
              : null;
          const current = { parentId: targetParentDriveId, fileName };
          await Promise.all([
            syncPostImages(accessToken, current, previous, body, groupFolderIds),
            syncGoogleDoc(accessToken, current, previous, body),
          ]);
        }

        const { data: contentCleared } = await supabase.rpc("mark_item_stored_in_drive", {
          p_id: item.id,
          p_drive_file_id: driveFileId,
          p_seen_updated_at: item.updated_at,
        });
        if (contentCleared && item.kind === "image" && item.storage_path) {
          await supabase.storage.from("images").remove([item.storage_path]);
        }
        processed++;
        remainingBudget--;
      } catch (err) {
        if (err instanceof DriveAuthError) {
          clearGoogleAccessToken(userId);
          throw err;
        }
        if (err instanceof DriveApiError && err.status === 401) {
          clearGoogleAccessToken(userId);
          throw new DriveAuthError(err.message);
        }

        const errMessage = err instanceof Error ? err.message : String(err);
        failed.push({
          id: item.id,
          title: item.title,
          message: errMessage,
        });

        const transient = isTransientError(err);
        const currentMeta =
          typeof item.meta === "object" && item.meta !== null
            ? (item.meta as Record<string, unknown>)
            : {};
        const previousAttempts =
          typeof currentMeta.drive_sync_attempts === "number" ? currentMeta.drive_sync_attempts : 0;
        const syncAttempts = transient ? previousAttempts : previousAttempts + 1;
        const giveUp = !transient && syncAttempts >= 3;

        const updatedMeta = {
          ...currentMeta,
          drive_sync_attempts: syncAttempts,
          drive_last_error: errMessage,
          drive_last_attempt_at: new Date().toISOString(),
        };

        await supabase.rpc("mark_item_sync_failed", {
          p_item_id: item.id,
          p_user_id: userId,
          p_meta: updatedMeta as Json,
          p_give_up: giveUp,
        });

        remainingBudget--;
      }
    };

    let nextIndex = 0;
    let authError: Error | null = null;

    const worker = async () => {
      while (nextIndex < itemsToProcess.length) {
        if (authError) break;
        if (isTimeExpired() || remainingBudget <= 0) break;
        const item = itemsToProcess[nextIndex++];
        try {
          await processItem(item);
        } catch (err) {
          if (err instanceof DriveAuthError) {
            authError = err;
            break;
          }
        }
      }
    };

    const poolSize = 4;
    const workerPromises = Array.from({ length: Math.min(poolSize, itemsToProcess.length) }, () =>
      worker(),
    );
    await Promise.all(workerPromises);

    if (authError) {
      throw authError;
    }
  }

  // 4. Remaining and final status
  const { data: unsavedCount, error: countError } = await supabase.rpc("drive_unsaved_count", {
    p_user_id: userId,
  });
  if (countError) {
    throw new Error(countError.message);
  }
  const remaining = unsavedCount ?? 0;
  const done = remaining === 0;

  if (done) {
    await supabase.from("drive_state").upsert(
      {
        user_id: userId,
        last_saved_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  }

  return {
    processed,
    remaining,
    done,
    failed,
  };
}
