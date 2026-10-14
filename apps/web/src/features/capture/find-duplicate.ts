import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export interface DuplicateInfo {
  item_id: string;
  folder_id: string;
  folder_name: string;
}

export function formatDuplicateMessage(folderName: string): string {
  if (!folderName || folderName === "another folder") {
    return "Already saved in another folder.";
  }
  return `Already saved in "${folderName}".`;
}

export async function findDuplicate(
  db: SupabaseClient<Database>,
  userId: string,
  canonicalUrl: string,
): Promise<DuplicateInfo | null> {
  const { data: item, error } = await db
    .from("items")
    .select("id, folder_id, folders!items_folder_id_fkey(name, deleted_at)")
    .eq("user_id", userId)
    .eq("canonical_url", canonicalUrl)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !item) {
    return null;
  }

  const folder = Array.isArray(item.folders) ? item.folders[0] : item.folders;
  const folderName = folder && !folder.deleted_at && folder.name ? folder.name : "another folder";

  return {
    item_id: item.id,
    folder_id: item.folder_id,
    folder_name: folderName,
  };
}

export async function nextPosition(
  db: SupabaseClient<Database>,
  userId: string,
  folderId: string | null,
  table: "items" | "folders" = "items",
): Promise<number> {
  if (table === "folders") {
    return nextFolderPosition(db, userId, folderId);
  }

  if (!folderId) {
    return 0;
  }

  const { data } = await db
    .from("items")
    .select("position")
    .eq("user_id", userId)
    .eq("folder_id", folderId)
    .is("deleted_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.position ?? -1) + 1;
}

export async function nextFolderPosition(
  db: SupabaseClient<Database>,
  userId: string,
  parentId: string | null,
): Promise<number> {
  let query = db.from("folders").select("position").eq("user_id", userId).is("deleted_at", null);

  if (parentId === null) {
    query = query.is("parent_id", null);
  } else {
    query = query.eq("parent_id", parentId);
  }

  const { data } = await query.order("position", { ascending: false }).limit(1).maybeSingle();

  return (data?.position ?? -1) + 1;
}
