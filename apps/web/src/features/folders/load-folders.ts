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
  const [foldersResult, itemsResult] = await Promise.all([
    db
      .from("folders")
      .select("id, parent_id, name, position")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("position", { ascending: true })
      .order("name", { ascending: true }),
    db.from("items").select("folder_id").eq("user_id", userId).is("deleted_at", null),
  ]);

  if (foldersResult.error) {
    throw new Error(foldersResult.error.message);
  }

  const itemCounts = new Map<string, number>();
  if (itemsResult.data) {
    for (const item of itemsResult.data) {
      if (item.folder_id) {
        itemCounts.set(item.folder_id, (itemCounts.get(item.folder_id) ?? 0) + 1);
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
