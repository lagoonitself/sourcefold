import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";

/** On a project that involves other people: the caller's role and who owns it. */
export type FolderSharing = {
  role: "owner" | "editor" | "viewer";
  owner_name: string;
  owner_email: string;
  member_count: number;
};

export type FolderItem = {
  id: string;
  parent_id: string | null;
  name: string;
  position: number;
  item_count: number;
  /** True only for an archived project (top-level folder). */
  archived: boolean;
  /** Only on a shared project (parent_id null); absent for a project nobody else is part of. */
  sharing?: FolderSharing;
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
  const [foldersResult, countsResult, accessResult] = await Promise.all([
    db
      .from("folders")
      .select("id, parent_id, name, position, archived_at")
      .is("deleted_at", null)
      .order("position", { ascending: true })
      .order("name", { ascending: true }),
    db.rpc("folder_item_counts", { p_user_id: userId }),
    db.rpc("project_access", { p_user_id: userId }),
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

  // An error here (a token client, an older database) just means nothing is shown as shared.
  const sharingOf = new Map<string, FolderSharing>();
  if (!accessResult.error) {
    for (const row of accessResult.data ?? []) {
      const role = row.your_role;
      if (role !== "owner" && role !== "editor" && role !== "viewer") continue;
      sharingOf.set(row.project_id, {
        role,
        owner_name: row.owner_name,
        owner_email: row.owner_email,
        member_count: Number(row.member_count) || 0,
      });
    }
  }

  let folders: FolderItem[] = (foldersResult.data ?? []).map((folder) => {
    const sharing = folder.parent_id === null ? sharingOf.get(folder.id) : undefined;
    return {
      id: folder.id,
      parent_id: folder.parent_id,
      name: folder.name,
      position: folder.position,
      item_count: itemCounts.get(folder.id) ?? 0,
      archived: folder.parent_id === null && folder.archived_at !== null,
      ...(sharing ? { sharing } : {}),
    };
  });

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
