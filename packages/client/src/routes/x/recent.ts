import { jsonData, jsonError } from "../../http";
import { findProjectId, projectFolderIds } from "../../features/projects/project";
import type { RouteContext } from "../../context";

/** Recent X threads in the project of `?folder=<group id>`, so threads never cross projects. */
export async function GET(auth: RouteContext, request: Request) {
  const folderId = new URL(request.url).searchParams.get("folder");
  if (!folderId) {
    return jsonError(400, "Query parameter 'folder' is required.");
  }

  const { data: folders, error: foldersError } = await auth.db
    .from("folders")
    .select("id, parent_id")
    .eq("user_id", auth.userId)
    .is("deleted_at", null);
  if (foldersError) {
    return jsonError(500, foldersError.message);
  }

  const projectId = findProjectId(folders ?? [], folderId);
  if (!projectId) {
    return jsonData([]);
  }

  const { data: items, error } = await auth.db
    .from("items")
    .select("id, title, folder_id, created_at")
    .eq("user_id", auth.userId)
    .eq("kind", "x")
    .in("folder_id", projectFolderIds(folders ?? [], projectId))
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return jsonError(500, error.message);
  }

  return jsonData(items ?? []);
}
