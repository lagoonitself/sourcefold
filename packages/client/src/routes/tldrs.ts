import { z } from "zod";
import { jsonData, jsonError } from "../http";
import { loadTldrsForItems } from "../features/tldrs";
import {
  groupIdsOf,
  isProjectId,
  loadItemsInGroups,
  loadLiveFolders,
} from "../features/research/projects";
import type { RouteContext } from "../context";

const idSchema = z.string().uuid();

/**
 * `GET /api/tldrs?folder=<group id>`: TL;DRs of the live sources directly in a group.
 * `GET /api/tldrs?project=<project id>`: TL;DRs of every live source in a project.
 */
export async function GET(auth: RouteContext, request: Request) {
  const url = new URL(request.url);
  const folder = url.searchParams.get("folder")?.trim() || null;
  const project = url.searchParams.get("project")?.trim() || null;

  if (!folder && !project) {
    return jsonError(400, "Query parameter 'folder' or 'project' is required.");
  }
  if (folder && project) {
    return jsonError(400, "Use either 'folder' or 'project', not both.");
  }

  try {
    let itemIds: string[];
    if (folder) {
      if (!idSchema.safeParse(folder).success) return jsonError(400, "Invalid folder ID");
      const { data, error } = await auth.db
        .from("items")
        .select("id")
        .eq("user_id", auth.userId)
        .eq("folder_id", folder)
        .is("deleted_at", null);
      if (error) return jsonError(500, error.message);
      itemIds = (data ?? []).map((row) => row.id);
    } else {
      if (!idSchema.safeParse(project).success) return jsonError(400, "Invalid project ID");
      const folders = await loadLiveFolders(auth.db, auth.userId);
      if (!isProjectId(folders, project!)) return jsonError(404, "Project not found");
      const groupIds = groupIdsOf(folders, project!);
      const items = groupIds.length
        ? await loadItemsInGroups<{ id: string; created_at: string }>(
            auth.db,
            auth.userId,
            groupIds,
            "id, created_at",
          )
        : [];
      itemIds = items.map((row) => row.id);
    }
    return jsonData(await loadTldrsForItems(auth.db, auth.userId, itemIds));
  } catch (error) {
    console.error("Failed to list TL;DRs:", error);
    return jsonError(500, "Something went wrong. Try again.");
  }
}
