import { z } from "zod";
import { normalizeTags } from "@sourcefold/core";
import { jsonData, jsonError } from "../../../http";
import { ITEM_LIST_COLUMNS } from "../../../features/items/item-columns";
import { loadLiveFolders, projectIdOf } from "../../../features/research/projects";
import type { RouteContext } from "../../../context";

const idSchema = z.string().uuid("Invalid item ID");

const mergeBodySchema = z.object({
  ids: z
    .array(z.string().uuid("Invalid item ID"), { error: "ids must be an array of UUIDs." })
    .min(1, "At least one item id must be provided to merge.")
    .max(20, "At most 20 items can be merged at once."),
});

type Params = { id: string };

export async function POST(auth: RouteContext, request: Request, params: Params) {
  const { id: keepId } = params;
  if (!idSchema.safeParse(keepId).success) {
    return jsonError(400, "Invalid item ID");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const parsed = mergeBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  const uniqueOtherIds = Array.from(new Set(parsed.data.ids));
  if (uniqueOtherIds.includes(keepId)) {
    return jsonError(400, "The keep id cannot be in the ids to merge.");
  }

  // Load folders to check project membership
  let folders;
  try {
    folders = await loadLiveFolders(auth.db, auth.userId);
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Failed to load folders.");
  }

  // Fetch keep item
  const { data: keepItem, error: keepError } = await auth.db
    .from("items")
    .select("id, folder_id, tags, triage, summary, author, author_type, note")
    .eq("id", keepId)
    .eq("user_id", auth.userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (keepError) return jsonError(500, keepError.message);
  if (!keepItem) return jsonError(404, "Item not found.");

  const keepProjectId = projectIdOf(folders, keepItem.folder_id);
  if (!keepProjectId) return jsonError(404, "Project not found.");

  // Fetch other items
  const { data: otherItems, error: othersError } = await auth.db
    .from("items")
    .select("id, folder_id, tags, triage, summary, author, author_type, note, created_at")
    .in("id", uniqueOtherIds)
    .eq("user_id", auth.userId)
    .is("deleted_at", null);

  if (othersError) return jsonError(500, othersError.message);
  if (!otherItems || otherItems.length !== uniqueOtherIds.length) {
    return jsonError(404, "One or more items to merge were not found.");
  }

  // Preserve order of other items as requested in body
  const othersMap = new Map(otherItems.map((o) => [o.id, o]));
  const orderedOthers = uniqueOtherIds.map((id) => othersMap.get(id)!);

  // Check that every other item is in the same project
  for (const other of orderedOthers) {
    const otherProjectId = projectIdOf(folders, other.folder_id);
    if (!otherProjectId || otherProjectId !== keepProjectId) {
      return jsonError(404, "All items to merge must belong to the same project.");
    }
  }

  // Move highlights
  const { data: movedH, error: moveHError } = await auth.db
    .from("highlights")
    .update({ item_id: keepId })
    .in("item_id", uniqueOtherIds)
    .eq("user_id", auth.userId)
    .select("id");

  if (moveHError) {
    console.error("Failed to move highlights during merge:", moveHError);
    return jsonError(500, moveHError.message);
  }

  // Move cards
  const { data: movedC, error: moveCError } = await auth.db
    .from("cards")
    .update({ item_id: keepId })
    .in("item_id", uniqueOtherIds)
    .eq("user_id", auth.userId)
    .select("id");

  if (moveCError) {
    console.error("Failed to move cards during merge:", moveCError);
    return jsonError(500, moveCError.message);
  }

  // Union tags: keep's first, normalizeTags
  const allTags = [...(keepItem.tags ?? []), ...orderedOthers.flatMap((o) => o.tags ?? [])];
  const mergedTags = normalizeTags(allTags).slice(0, 20);

  // triage, summary, author, author_type filled from first other that has them when keep has none
  const mergedTriage = keepItem.triage ?? orderedOthers.find((o) => o.triage)?.triage ?? null;
  const mergedSummary = keepItem.summary ?? orderedOthers.find((o) => o.summary)?.summary ?? null;
  const mergedAuthor = keepItem.author ?? orderedOthers.find((o) => o.author)?.author ?? null;
  const mergedAuthorType =
    keepItem.author_type ?? orderedOthers.find((o) => o.author_type)?.author_type ?? null;

  // Notes: joined with a blank line when both have one and they differ; else filled from first other
  let mergedNote = keepItem.note ?? null;
  const firstOtherWithNote = orderedOthers.find((o) => o.note && o.note.trim());
  if (firstOtherWithNote && firstOtherWithNote.note) {
    if (!mergedNote || !mergedNote.trim()) {
      mergedNote = firstOtherWithNote.note;
    } else if (firstOtherWithNote.note.trim() !== mergedNote.trim()) {
      mergedNote = `${mergedNote}\n\n${firstOtherWithNote.note}`;
    }
  }

  // Update keep item
  const { data: updatedKeep, error: updateKeepError } = await auth.db
    .from("items")
    .update({
      tags: mergedTags,
      triage: mergedTriage,
      summary: mergedSummary,
      author: mergedAuthor,
      author_type: mergedAuthorType,
      note: mergedNote,
      updated_at: new Date().toISOString(),
    })
    .eq("id", keepId)
    .eq("user_id", auth.userId)
    .select(ITEM_LIST_COLUMNS)
    .maybeSingle();

  if (updateKeepError || !updatedKeep) {
    return jsonError(500, updateKeepError?.message ?? "Failed to update kept item.");
  }

  // Soft delete other items
  const { error: deleteOthersError } = await auth.db
    .from("items")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", uniqueOtherIds)
    .eq("user_id", auth.userId)
    .is("deleted_at", null);

  if (deleteOthersError) {
    console.error("Failed to delete merged items:", deleteOthersError);
    return jsonError(500, deleteOthersError.message);
  }

  return jsonData({
    item: updatedKeep,
    moved_highlights: movedH?.length ?? 0,
    moved_cards: movedC?.length ?? 0,
  });
}
