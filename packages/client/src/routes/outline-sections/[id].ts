import { sameTag, normalizeTags } from "@sourcefold/core";
import { jsonData, jsonError } from "../../http";
import {
  OUTLINE_SECTION_COLUMNS,
  outlineSectionIdSchema,
  outlineSectionInputSchema,
} from "../../features/research/outline-sections";
import {
  groupIdsOf,
  isProjectId,
  loadItemsInGroups,
  loadLiveFolders,
} from "../../features/research/projects";
import type { RouteContext } from "../../context";

type Params = { id: string };

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

export async function PUT(auth: RouteContext, request: Request, params: Params) {
  const { id } = params;
  if (!outlineSectionIdSchema.safeParse(id).success) {
    return jsonError(400, "Invalid outline section ID");
  }

  const json = await readJson(request);
  if (!json.ok) return jsonError(400, "Invalid JSON body");

  const parsed = outlineSectionInputSchema.safeParse(json.body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  if (parsed.data.id !== id) {
    return jsonError(400, "The section id in the body must match the URL.");
  }

  // Load live folders for project validation
  let folders;
  try {
    folders = await loadLiveFolders(auth.db, auth.userId);
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Failed to load folders.");
  }

  if (!isProjectId(folders, parsed.data.project_id)) {
    return jsonError(400, "Invalid project ID: must be a top-level project.");
  }

  // Check if section exists
  const { data: existing, error: existingError } = await auth.db
    .from("outline_sections")
    .select("id, title, project_id, user_id")
    .eq("id", id)
    .maybeSingle();

  if (existingError) return jsonError(500, existingError.message);
  if (existing && existing.user_id !== auth.userId) {
    return jsonError(404, "Outline section not found.");
  }

  const newTitle = parsed.data.title.trim();

  // If existing and title changed: rename tag on all live sources in the project
  if (existing && existing.title.trim() !== newTitle) {
    const oldTitle = existing.title.trim();
    const groupIds = groupIdsOf(folders, existing.project_id);
    if (groupIds.length > 0) {
      try {
        const items = await loadItemsInGroups<{ id: string; tags: string[]; created_at: string }>(
          auth.db,
          auth.userId,
          groupIds,
          "id, tags, created_at",
        );
        for (const item of items) {
          if (item.tags && item.tags.some((t) => sameTag(t, oldTitle))) {
            const updatedTags = normalizeTags(
              item.tags.map((t) => (sameTag(t, oldTitle) ? newTitle : t)),
            ).slice(0, 20);

            await auth.db
              .from("items")
              .update({ tags: updatedTags })
              .eq("id", item.id)
              .eq("user_id", auth.userId);
          }
        }
      } catch (err) {
        console.error("Failed to rename tags across project sources:", err);
      }
    }
  }

  const result = existing
    ? await auth.db
        .from("outline_sections")
        .update({
          title: newTitle,
          position: parsed.data.position,
        })
        .eq("id", id)
        .eq("user_id", auth.userId)
        .select(OUTLINE_SECTION_COLUMNS)
        .maybeSingle()
    : await auth.db
        .from("outline_sections")
        .insert({
          id,
          project_id: parsed.data.project_id,
          title: newTitle,
          position: parsed.data.position,
          user_id: auth.userId,
        })
        .select(OUTLINE_SECTION_COLUMNS)
        .maybeSingle();

  if (result.error) {
    if (result.error.code === "23505") return jsonError(404, "Outline section not found.");
    return jsonError(500, result.error.message);
  }
  if (!result.data) return jsonError(404, "Outline section not found.");

  return jsonData(result.data);
}

export async function DELETE(auth: RouteContext, request: Request, params: Params) {
  const { id } = params;
  if (!outlineSectionIdSchema.safeParse(id).success) {
    return jsonError(400, "Invalid outline section ID");
  }

  // Disassociate cards in this section (set section_id = null)
  await auth.db
    .from("cards")
    .update({ section_id: null })
    .eq("section_id", id)
    .eq("user_id", auth.userId);

  const { data, error } = await auth.db
    .from("outline_sections")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.userId)
    .select("id")
    .maybeSingle();

  if (error) return jsonError(500, error.message);
  if (!data) return jsonError(404, "Outline section not found.");

  return jsonData({ id });
}
