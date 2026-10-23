import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import { groupIdsOf, groupPathOf, loadLiveFolders, projectIdOf } from "../research/projects";

export interface DuplicateInfo {
  item_id: string;
  folder_id: string;
  folder_name: string;
}

export function formatDuplicateMessage(folderName: string): string {
  if (!folderName || folderName === "another folder") {
    return "Already saved in this group.";
  }
  return `Already saved in "${folderName}".`;
}

/**
 * A link may be saved once per group. The same link can live in other groups of the same
 * project, and projects never see each other's links.
 */
/**
 * Message for the item trigger's "invalid folder" errors: the group was deleted, or the
 * target is a project (sources live only in groups).
 */
export function invalidFolderMessage(dbMessage: string): string {
  return dbMessage.includes("sources must be saved in a group")
    ? "Pick a group. Sources can't be saved directly in a project."
    : "That group no longer exists.";
}

export async function findDuplicate(
  db: SupabaseClient<Database>,
  userId: string,
  canonicalUrl: string,
  folderId: string,
): Promise<DuplicateInfo | null> {
  const { data: item, error } = await db
    .from("items")
    .select("id, folder_id, folders!items_folder_id_fkey(name, deleted_at)")
    .eq("user_id", userId)
    .eq("canonical_url", canonicalUrl)
    .eq("folder_id", folderId)
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

/** The same link saved in another group of the same project. */
export interface ElsewhereInfo {
  item_id: string;
  folder_id: string;
  /** The group's path without the project's name, groups joined by "/". */
  folder_path: string;
}

/**
 * Finds a live source with this canonical link in a group other than `folderId` but inside the
 * same project (projects never see each other's links). The oldest copy wins. Null when the
 * group isn't in a project, so the insert's own folder check reports the problem.
 */
export async function findDuplicateElsewhere(
  db: SupabaseClient<Database>,
  userId: string,
  canonicalUrl: string,
  folderId: string,
): Promise<ElsewhereInfo | null> {
  // Few rows match a link, so look it up first and test the project in code.
  const { data: copies, error } = await db
    .from("items")
    .select("id, folder_id, created_at")
    .eq("user_id", userId)
    .eq("canonical_url", canonicalUrl)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  const others = Array.isArray(copies) ? copies.filter((c) => c.folder_id !== folderId) : [];
  if (error || others.length === 0) return null;

  let folders;
  try {
    folders = await loadLiveFolders(db, userId);
  } catch {
    return null;
  }
  const projectId = projectIdOf(folders, folderId);
  if (!projectId) return null;
  const groups = new Set(groupIdsOf(folders, projectId));
  const hit = others.find((c) => groups.has(c.folder_id));
  if (!hit) return null;
  return {
    item_id: hit.id,
    folder_id: hit.folder_id,
    folder_path: groupPathOf(folders, hit.folder_id),
  };
}

export function formatElsewhereMessage(folderPath: string): string {
  return `Already saved in ${folderPath}.`;
}

/** The 409 body for a link that is already saved in another group of the project. */
export function elsewhereError(existing: ElsewhereInfo) {
  return {
    code: "duplicate" as const,
    message: formatElsewhereMessage(existing.folder_path),
    item_id: existing.item_id,
    folder_id: existing.folder_id,
    folder_name: existing.folder_path,
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
