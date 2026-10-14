import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type FolderItem = {
  id: string;
  parent_id: string | null;
  name: string;
  position: number;
  item_count: number;
};

export async function loadFolders(
  db: SupabaseClient<Database>,
  userId: string,
): Promise<FolderItem[]> {
  const [foldersResult, countsResult] = await Promise.all([
    db
      .from("folders")
      .select("id, parent_id, name, position")
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

  const folders: FolderItem[] = (foldersResult.data ?? []).map((folder) => ({
    id: folder.id,
    parent_id: folder.parent_id,
    name: folder.name,
    position: folder.position,
    item_count: itemCounts.get(folder.id) ?? 0,
  }));

  folders.sort((a, b) => {
    if (a.position !== b.position) {
      return a.position - b.position;
    }
    return a.name.localeCompare(b.name);
  });

  return folders;
}
