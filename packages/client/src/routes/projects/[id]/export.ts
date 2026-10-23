import { z } from "zod";
import { PROJECT_EXPORT_TABLES } from "@sourcefold/core/project-file";
import { jsonData, jsonError } from "../../../http";
import { exportPage, loadProject } from "../../../features/project-file/export-pages";
import type { RouteContext } from "../../../context";

const querySchema = z.object({
  table: z.enum(PROJECT_EXPORT_TABLES, { message: "Unknown table." }),
  from: z.coerce.number().int().min(0).max(10_000_000).default(0),
});

// One page (up to 500 rows) of a project for the project file. See docs/PROJECT-FILE.md.
export async function GET(auth: RouteContext, request: Request, params: { id: string }) {
  const { id } = params;
  if (!z.string().uuid().safeParse(id).success) return jsonError(400, "Invalid project ID.");

  const search = new URL(request.url).searchParams;
  const query = querySchema.safeParse({
    table: search.get("table"),
    from: search.get("from") ?? undefined,
  });
  if (!query.success) {
    return jsonError(400, query.error.issues[0]?.message ?? "Invalid request.");
  }

  try {
    const project = await loadProject(auth.db, auth.userId, id);
    if (!project) return jsonError(404, "Project not found.");
    const page = await exportPage(auth.db, auth.userId, project, query.data.table, query.data.from);
    return jsonData(page);
  } catch (err) {
    console.error("Failed to export a project page:", err);
    return jsonError(500, "Couldn't read the project. Try again.");
  }
}
