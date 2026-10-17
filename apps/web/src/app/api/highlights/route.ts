import { z } from "zod";
import { jsonData, jsonError, requireApiUser } from "@/lib/api";
import { loadHighlightsForItems } from "@/features/highlights/load";

export const dynamic = "force-dynamic";

const itemIdSchema = z.string().uuid("Invalid item ID");
const folderIdSchema = z.string().uuid("Invalid folder ID");

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const item = url.searchParams.get("item")?.trim() || null;
  const folder = url.searchParams.get("folder")?.trim() || null;

  if (!item && !folder) {
    return jsonError(400, "Query parameter 'item' or 'folder' is required.");
  }
  if (item && folder) {
    return jsonError(400, "Use either 'item' or 'folder', not both.");
  }

  let itemIds: string[];

  if (item) {
    if (!itemIdSchema.safeParse(item).success) {
      return jsonError(400, "Invalid item ID");
    }
    const { data: found, error } = await auth.db
      .from("items")
      .select("id")
      .eq("id", item)
      .eq("user_id", auth.userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return jsonError(500, error.message);
    if (!found) return jsonError(404, "Item not found.");
    itemIds = [found.id];
  } else {
    if (!folderIdSchema.safeParse(folder).success) {
      return jsonError(400, "Invalid folder ID");
    }
    const { data: found, error } = await auth.db
      .from("folders")
      .select("id")
      .eq("id", folder!)
      .eq("user_id", auth.userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return jsonError(500, error.message);
    if (!found) return jsonError(404, "Folder not found.");

    const { data: items, error: itemsError } = await auth.db
      .from("items")
      .select("id")
      .eq("folder_id", found.id)
      .eq("user_id", auth.userId)
      .is("deleted_at", null);
    if (itemsError) return jsonError(500, itemsError.message);
    itemIds = (items ?? []).map((row) => row.id);
  }

  try {
    const byItem = await loadHighlightsForItems(auth.db, auth.userId, itemIds);
    // Item ids are uuids in canonical lowercase, so a plain sort matches the database order.
    const sortedIds = [...byItem.keys()].sort();
    return jsonData(sortedIds.flatMap((id) => byItem.get(id) ?? []));
  } catch (error) {
    console.error("Failed to list highlights:", error);
    return jsonError(500, "Something went wrong. Try again.");
  }
}
