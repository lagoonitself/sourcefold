import { z } from "zod";
import { sortSections } from "@sourcefold/core";
import { jsonData, jsonError } from "../http";
import { OUTLINE_SECTION_COLUMNS } from "../features/research/outline-sections";
import type { RouteContext } from "../context";

const idSchema = z.string().uuid("Invalid project ID");

export async function GET(auth: RouteContext, request: Request) {
  const url = new URL(request.url);
  const project = url.searchParams.get("project")?.trim() || null;

  if (!project) {
    return jsonError(400, "Query parameter 'project' is required.");
  }

  if (!idSchema.safeParse(project).success) {
    return jsonError(400, "Invalid project ID");
  }

  const { data: sections, error } = await auth.db
    .from("outline_sections")
    .select(OUTLINE_SECTION_COLUMNS)
    .eq("project_id", project)
    .eq("user_id", auth.userId);

  if (error) return jsonError(500, error.message);

  return jsonData(sortSections(sections ?? []));
}
