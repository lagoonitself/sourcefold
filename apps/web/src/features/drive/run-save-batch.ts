import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createFolder, getFile, updateFile, uploadFile, DriveApiError } from "@/lib/google/drive";
import { DriveAuthError } from "@/lib/google/oauth";
import { buildItemFile, driveFileName, folderPathOf, type FolderRef } from "./build-file";

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

export async function runSaveBatch(
  supabase: SupabaseClient<Database>,
  userId: string,
  accessToken: string,
  budget = 20,
): Promise<SaveBatchResult> {
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
      await supabase.from("folders").update({ drive_synced_at: null }).is("deleted_at", null);
      await supabase.from("items").update({ drive_synced_at: null }).is("deleted_at", null);
    }
    remainingBudget--;
    processed++;
  }

  // 2. Folders
  const { data: allFoldersData, error: allFoldersError } = await supabase
    .from("folders")
    .select("id, parent_id, name, drive_folder_id, deleted_at");

  if (allFoldersError || !allFoldersData) {
    throw new Error(allFoldersError?.message || "Failed to load folders");
  }

  const foldersById = new Map<string, FolderRow>();
  for (const f of allFoldersData) {
    foldersById.set(f.id, { ...f });
  }

  const { data: dirtyFolders, error: dirtyFoldersError } =
    await supabase.rpc("drive_dirty_folders");
  if (dirtyFoldersError || !dirtyFolders) {
    throw new Error(dirtyFoldersError?.message || "Failed to get dirty folders");
  }

  const depths = computeFolderDepths(foldersById);
  const liveDirtyFolders = dirtyFolders
    .filter((f) => f.deleted_at === null)
    .sort((a, b) => (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0));
  const deletedDirtyFolders = dirtyFolders.filter(
    (f) => f.deleted_at !== null && f.drive_folder_id !== null,
  );

  for (const folder of liveDirtyFolders) {
    if (remainingBudget <= 0) break;

    const parentDriveId =
      folder.parent_id === null
        ? rootFolderId
        : (foldersById.get(folder.parent_id)?.drive_folder_id ?? null);

    if (!parentDriveId) {
      // Parent has no Drive ID yet; skip this folder for this batch
      continue;
    }

    if (!folder.drive_folder_id) {
      const created = await createFolder(accessToken, folder.name, parentDriveId);
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
        const created = await createFolder(accessToken, folder.name, parentDriveId);
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
            .is("deleted_at", null);
        }
        await supabase
          .from("items")
          .update({ drive_synced_at: null })
          .in("folder_id", subtreeIds)
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
          name: folder.name,
          addParents,
          removeParents,
        });

        await supabase.rpc("mark_folder_synced", {
          p_id: folder.id,
          p_drive_folder_id: folder.drive_folder_id,
        });
        processed++;
        remainingBudget--;

        const descendantIds = getFolderAndDescendantIds(folder.id, allFoldersData);
        await supabase
          .from("items")
          .update({ drive_synced_at: null })
          .in("folder_id", descendantIds)
          .is("deleted_at", null);
      }
    }
  }

  for (const folder of deletedDirtyFolders) {
    if (remainingBudget <= 0) break;
    if (folder.drive_folder_id) {
      try {
        await updateFile(accessToken, folder.drive_folder_id, { trashed: true });
      } catch (err) {
        if (err instanceof DriveAuthError) throw err;
        if (err instanceof DriveApiError && err.status === 401) {
          throw new DriveAuthError(err.message);
        }
        if (!(err instanceof DriveApiError && err.status === 404)) {
          throw err;
        }
      }

      await supabase.from("folders").update({ drive_folder_id: null }).eq("id", folder.id);

      const folderRef = foldersById.get(folder.id);
      if (folderRef) folderRef.drive_folder_id = null;
      processed++;
      remainingBudget--;
    }
  }

  // 3. Items
  if (remainingBudget > 0) {
    const { data: dirtyItems, error: dirtyItemsError } = await supabase.rpc("drive_dirty_items", {
      p_limit: remainingBudget,
    });

    if (dirtyItemsError) {
      throw new Error(dirtyItemsError.message);
    }

    const folderItemsCache = new Map<string, { id: string; title: string }[]>();

    const getFolderSiblings = async (folderId: string) => {
      const cached = folderItemsCache.get(folderId);
      if (cached) return cached;
      const { data, error } = await supabase
        .from("items")
        .select("id, title")
        .eq("folder_id", folderId)
        .is("deleted_at", null);
      if (error || !data) return [];
      folderItemsCache.set(folderId, data);
      return data;
    };

    for (const item of dirtyItems ?? []) {
      if (remainingBudget <= 0) break;

      try {
        if (item.deleted_at !== null) {
          if (item.drive_file_id) {
            try {
              await updateFile(accessToken, item.drive_file_id, { trashed: true });
            } catch (err) {
              if (err instanceof DriveAuthError) throw err;
              if (err instanceof DriveApiError && err.status === 401) {
                throw new DriveAuthError(err.message);
              }
              if (!(err instanceof DriveApiError && err.status === 404)) {
                throw err;
              }
            }

            await supabase.from("items").update({ drive_file_id: null }).eq("id", item.id);

            processed++;
            remainingBudget--;
          }
          continue;
        }

        const targetParentDriveId = foldersById.get(item.folder_id)?.drive_folder_id;
        if (!targetParentDriveId) {
          continue;
        }

        const siblings = await getFolderSiblings(item.folder_id);
        const siblingTitles = siblings.filter((s) => s.id !== item.id).map((s) => s.title);

        let fileName: string;
        let mimeType: string;
        let body: string | Uint8Array;

        if (item.kind === "image") {
          const meta =
            typeof item.meta === "object" && item.meta !== null
              ? (item.meta as Record<string, unknown>)
              : {};
          mimeType = (meta.mime_type as string) || "application/octet-stream";

          let ext = "";
          if (typeof meta.file_name === "string" && meta.file_name.includes(".")) {
            ext = meta.file_name.split(".").pop() || "";
          }
          if (!ext) {
            if (mimeType === "image/jpeg") ext = "jpg";
            else if (mimeType === "image/png") ext = "png";
            else if (mimeType === "image/gif") ext = "gif";
            else if (mimeType === "image/webp") ext = "webp";
            else if (mimeType === "image/svg+xml") ext = "svg";
            else ext = "bin";
          }

          fileName = driveFileName(item.title, item.id, siblingTitles, ext);

          if (!item.storage_path) {
            throw new Error("Missing storage_path for image item");
          }
          const { data: blob, error: downloadError } = await supabase.storage
            .from("images")
            .download(item.storage_path);
          if (downloadError || !blob) {
            throw new Error(downloadError?.message || "Failed to download image from storage");
          }
          const arrayBuffer = await blob.arrayBuffer();
          body = new Uint8Array(arrayBuffer);
        } else {
          mimeType = "text/markdown";
          fileName = driveFileName(item.title, item.id, siblingTitles, "md");
          const folderPath = folderPathOf(item.folder_id, foldersById as Map<string, FolderRef>);
          body = buildItemFile(item, folderPath);
        }

        if (item.drive_file_id) {
          const existing = await getFile(accessToken, item.drive_file_id);
          if (existing && !existing.trashed) {
            let addParents: string | undefined;
            let removeParents: string | undefined;
            if (!existing.parents?.includes(targetParentDriveId)) {
              addParents = targetParentDriveId;
              removeParents = existing.parents?.join(",");
            }

            await uploadFile(accessToken, {
              id: item.drive_file_id,
              name: fileName,
              mimeType,
              body,
              addParents,
              removeParents,
            });

            await supabase.rpc("mark_item_synced", {
              p_id: item.id,
              p_drive_file_id: item.drive_file_id,
            });
            processed++;
            remainingBudget--;
          } else {
            const created = await uploadFile(accessToken, {
              name: fileName,
              parentId: targetParentDriveId,
              mimeType,
              body,
            });

            await supabase.rpc("mark_item_synced", {
              p_id: item.id,
              p_drive_file_id: created.id,
            });
            processed++;
            remainingBudget--;
          }
        } else {
          const created = await uploadFile(accessToken, {
            name: fileName,
            parentId: targetParentDriveId,
            mimeType,
            body,
          });

          await supabase.rpc("mark_item_synced", {
            p_id: item.id,
            p_drive_file_id: created.id,
          });
          processed++;
          remainingBudget--;
        }
      } catch (err) {
        if (err instanceof DriveAuthError) {
          throw err;
        }
        if (err instanceof DriveApiError && err.status === 401) {
          throw new DriveAuthError(err.message);
        }
        failed.push({
          id: item.id,
          title: item.title,
          message: err instanceof Error ? err.message : String(err),
        });
        remainingBudget--;
      }
    }
  }

  // 4. Remaining and final status
  const { data: unsavedCount, error: countError } = await supabase.rpc("drive_unsaved_count");
  if (countError) {
    throw new Error(countError.message);
  }
  const remaining = unsavedCount ?? 0;
  const done = remaining === 0;

  if (done) {
    await supabase.from("drive_state").upsert(
      {
        user_id: userId,
        root_folder_id: rootFolderId,
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
