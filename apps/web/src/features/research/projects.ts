import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { findProjectId, projectFolderIds } from "@/features/projects/project";

// Research tools work inside one project (a top-level folder). These helpers resolve a folder to
// its project and a group to its path. Every query filters by user_id because the token routes
// use the admin client.

export interface LiveFolder {
  id: string;
  parent_id: string | null;
  name: string;
}

const PAGE_SIZE = 1000;

/** Runs a ranged query until a page comes back short (PostgREST returns at most 1000 rows). */
export async function selectAllPages<T>(
  run: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await run(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

/** The user's folders that aren't deleted: projects and groups. */
export async function loadLiveFolders(
  db: SupabaseClient<Database>,
  userId: string,
): Promise<LiveFolder[]> {
  return selectAllPages<LiveFolder>((from, to) =>
    db
      .from("folders")
      .select("id, parent_id, name")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
}

export function isProjectId(folders: LiveFolder[], id: string): boolean {
  return folders.some((f) => f.id === id && f.parent_id === null);
}

/** The ids of every group inside a project (not the project itself). */
export function groupIdsOf(folders: LiveFolder[], projectId: string): string[] {
  return projectFolderIds(folders, projectId).filter((id) => id !== projectId);
}

/** The project a folder belongs to, or null when the folder (or an ancestor) is gone. */
export function projectIdOf(folders: LiveFolder[], folderId: string): string | null {
  return findProjectId(folders, folderId);
}

/**
 * A group's path without its project's name, groups joined by `/`: "Compute/Ending".
 * Real names, as typed.
 */
export function groupPathOf(folders: LiveFolder[], folderId: string): string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && current.parent_id && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = byId.get(current.parent_id);
  }
  // A folder that is itself a project has no group path; fall back to its name.
  return names.length > 0 ? names.join("/") : (byId.get(folderId)?.name ?? "");
}

const FOLDER_CHUNK = 50;

/**
 * Every live item of the user in these groups, ordered by created_at then id. Chunked so the
 * request stays short however many groups a project has, and paged past PostgREST's row limit.
 */
export async function loadItemsInGroups<T extends { created_at: string; id: string }>(
  db: SupabaseClient<Database>,
  userId: string,
  groupIds: string[],
  columns: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < groupIds.length; i += FOLDER_CHUNK) {
    const chunk = groupIds.slice(i, i + FOLDER_CHUNK);
    const page = await selectAllPages<T>(
      (from, to) =>
        db
          .from("items")
          .select(columns)
          .eq("user_id", userId)
          .in("folder_id", chunk)
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: T[] | null;
          error: { message: string } | null;
        }>,
    );
    rows.push(...page);
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return rows.sort((a, b) => cmp(a.created_at, b.created_at) || cmp(a.id, b.id));
}
