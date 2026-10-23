import { z } from "zod";
import { jsonData, jsonError } from "../http";
import {
  groupIdsOf,
  isProjectId,
  loadItemsInGroups,
  loadLiveFolders,
} from "../features/research/projects";
import type { RouteContext } from "../context";

const folderIdSchema = z.string().uuid("Invalid folder ID");
const projectIdSchema = z.string().uuid("Invalid project ID");

const ITEM_COLUMNS =
  "id, folder_id, kind, title, source_url, canonical_url, status, created_at, meta, note, triage, tags, summary, author, author_type" as const;

export async function GET(auth: RouteContext, request: Request) {
  const url = new URL(request.url);
  const folder = url.searchParams.get("folder")?.trim() || null;
  const project = url.searchParams.get("project")?.trim() || null;
  const q = url.searchParams.get("q")?.trim() || null;

  if (!folder && !project && !q) {
    return jsonError(400, "Query parameter 'folder', 'project' or 'q' is required.");
  }

  if (folder) {
    const parsed = folderIdSchema.safeParse(folder);
    if (!parsed.success) {
      return jsonError(400, "Invalid folder ID");
    }

    const { data: items, error } = await auth.db
      .from("items")
      .select(ITEM_COLUMNS)
      .eq("user_id", auth.userId)
      .eq("folder_id", folder)
      .is("deleted_at", null)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      return jsonError(500, error.message);
    }

    return jsonData(items ?? []);
  }

  if (project) {
    const parsed = projectIdSchema.safeParse(project);
    if (!parsed.success) {
      return jsonError(400, "Invalid project ID");
    }

    try {
      const folders = await loadLiveFolders(auth.db, auth.userId);
      if (!isProjectId(folders, project)) {
        return jsonError(404, "Project not found");
      }
      const groupIds = groupIdsOf(folders, project);
      if (groupIds.length === 0) {
        return jsonData([]);
      }
      const items = await loadItemsInGroups(auth.db, auth.userId, groupIds, ITEM_COLUMNS);
      return jsonData(items);
    } catch (error) {
      console.error("Failed to load project items:", error);
      return jsonError(500, error instanceof Error ? error.message : "Something went wrong.");
    }
  }

  if (q) {
    const escaped = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

    const { data: items, error } = await auth.db
      .from("items")
      .select(ITEM_COLUMNS)
      .eq("user_id", auth.userId)
      .is("deleted_at", null)
      .ilike("title", `%${escaped}%`)
      .order("title", { ascending: true })
      .limit(100);

    if (error) {
      return jsonError(500, error.message);
    }

    return jsonData(items ?? []);
  }

  return jsonError(400, "Query parameter 'folder', 'project' or 'q' is required.");
}
