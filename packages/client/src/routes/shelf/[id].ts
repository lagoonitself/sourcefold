import { z } from "zod";
import { jsonData, jsonError } from "../../http";
import { rowToShelfLink, SHELF_COLUMNS, shelfPatchSchema } from "../../features/shelf";
import type { RouteContext } from "../../context";
import type { Database } from "../../database.types";

type Params = { id: string };

const idSchema = z.string().uuid();

/** `PATCH /api/shelf/<id>`: changes a link's URL, title, note, tags or pin. */
export async function PATCH(auth: RouteContext, request: Request, params: Params) {
  if (!idSchema.safeParse(params.id).success) return jsonError(400, "Invalid link ID");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const parsed = shelfPatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }
  const patch = parsed.data;
  const update: Database["public"]["Tables"]["shelf_links"]["Update"] = {};
  if (patch.url) {
    update.url = patch.url.url;
    update.key = patch.url.key;
  }
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.note !== undefined) update.note = patch.note;
  if (patch.tags !== undefined) update.tags = patch.tags;
  if (patch.pinned !== undefined) update.pinned = patch.pinned;

  if (update.key) {
    const { data: clash, error: clashError } = await auth.db
      .from("shelf_links")
      .select("id")
      .eq("user_id", auth.userId)
      .eq("key", update.key)
      .neq("id", params.id)
      .maybeSingle();
    if (clashError) return jsonError(500, clashError.message);
    if (clash) return jsonError(409, "That link is already on your shelf.");
  }

  const { data, error } = Object.keys(update).length
    ? await auth.db
        .from("shelf_links")
        .update(update)
        .eq("id", params.id)
        .eq("user_id", auth.userId)
        .select(SHELF_COLUMNS)
        .maybeSingle()
    : await auth.db
        .from("shelf_links")
        .select(SHELF_COLUMNS)
        .eq("id", params.id)
        .eq("user_id", auth.userId)
        .maybeSingle();
  if (error) {
    if (error.code === "23505") return jsonError(409, "That link is already on your shelf.");
    return jsonError(500, error.message);
  }
  if (!data) return jsonError(404, "Link not found.");
  return jsonData(rowToShelfLink(data));
}

/** `DELETE /api/shelf/<id>`: takes a link off the shelf. */
export async function DELETE(auth: RouteContext, _request: Request, params: Params) {
  if (!idSchema.safeParse(params.id).success) return jsonError(400, "Invalid link ID");
  const { data, error } = await auth.db
    .from("shelf_links")
    .delete()
    .eq("id", params.id)
    .eq("user_id", auth.userId)
    .select("id")
    .maybeSingle();
  if (error) return jsonError(500, error.message);
  if (!data) return jsonError(404, "Link not found.");
  return jsonData({ id: data.id });
}
