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
    .select("id, folder_id")
    .eq("user_id", userId)
    .eq("canonical_url", canonicalUrl)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !item) {
    return null;
  }

  let folderName = "another folder";
  if (item.folder_id) {
    const { data: folder } = await db
      .from("folders")
      .select("name")
      .eq("user_id", userId)
      .eq("id", item.folder_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (folder?.name) {
      folderName = folder.name;
    }
  }

  return {
    item_id: item.id,
    folder_id: item.folder_id,
    folder_name: folderName,
  };
}

export async function nextPosition(
  db: SupabaseClient<Database>,
  userId: string,
  folderId: string,
): Promise<number> {
  const { data: siblings } = await db
    .from("items")
    .select("position")
    .eq("user_id", userId)
    .eq("folder_id", folderId)
    .is("deleted_at", null);

  const maxPosition =
    siblings && siblings.length > 0 ? Math.max(...siblings.map((item) => item.position)) : -1;
  return maxPosition + 1;
}
