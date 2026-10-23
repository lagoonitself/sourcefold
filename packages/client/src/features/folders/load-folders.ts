import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";

export type FolderItem = {
  id: string;
  parent_id: string | null;
  name: string;
  position: number;
  item_count: number;
  /** True only for an archived project (top-level folder). */
  archived: boolean;
};

/**
 * Archived projects and their groups are left out unless includeArchived is set. Only the
 * sidebar and folder pages include them; pickers, the extension and search never see them.
 */
export async function loadFolders(
  db: SupabaseClient<Database>,
  userId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<FolderItem[]> {
  const [foldersResult, countsResult] = await Promise.all([
    db
      .from("folders")
      .select("id, parent_id, name, position, archived_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("position", { ascending: true })
      .order("name", { ascending: true }),
    db.rpc("folder_item_counts", { p_user_id: userId }),
  ]);

  if (foldersResult.error) {
    throw new Error(foldersResult.error.message);
  }
  if (countsResult.error) {
    throw new Error(countsResult.error.message);
  }

  const itemCounts = new Map<string, number>();
  if (countsResult.data) {
    for (const row of countsResult.data) {
      if (row.folder_id) {
        itemCounts.set(row.folder_id, Number(row.item_count) || 0);
      }
    }
  }

  let folders: FolderItem[] = (foldersResult.data ?? []).map((folder) => ({
    id: folder.id,
    parent_id: folder.parent_id,
    name: folder.name,
    position: folder.position,
    item_count: itemCounts.get(folder.id) ?? 0,
    archived: folder.parent_id === null && folder.archived_at !== null,
  }));

  if (!includeArchived) {
    const hidden = archivedFolderIds(folders);
    folders = folders.filter((folder) => !hidden.has(folder.id));
  }

  folders.sort((a, b) => {
    if (a.position !== b.position) {
      return a.position - b.position;
    }
    return a.name.localeCompare(b.name);
  });

  return folders;
}

/** Archived projects plus every group inside them. */
export function archivedFolderIds(
  folders: { id: string; parent_id: string | null; archived: boolean }[],
): Set<string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const hidden = new Set<string>();
  for (const folder of folders) {
    let current: (typeof folders)[number] | undefined = folder;
    for (let depth = 0; current && depth < 1000; depth++) {
      if (!current.parent_id) {
        if (current.archived) hidden.add(folder.id);
        break;
      }
      current = byId.get(current.parent_id);
    }
  }
  return hidden;
}
