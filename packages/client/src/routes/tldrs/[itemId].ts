import { z } from "zod";
import { jsonData, jsonError } from "../../http";
import { rowToTldr, TLDR_COLUMNS, tldrInputSchema, type TldrRow } from "../../features/tldrs";
import type { RouteContext } from "../../context";
import type { Json } from "../../database.types";

type Params = { itemId: string };

const idSchema = z.string().uuid();

/** `PUT /api/tldrs/<item id>`: sets the source's TL;DR (`ItemTldrInput`), replacing any old one. */
export async function PUT(auth: RouteContext, request: Request, params: Params) {
  const { itemId } = params;
  if (!idSchema.safeParse(itemId).success) return jsonError(400, "Invalid item ID");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const parsed = tldrInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  const { data: item, error: itemError } = await auth.db
    .from("items")
    .select("id")
    .eq("id", itemId)
    .eq("user_id", auth.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (itemError) return jsonError(500, itemError.message);
  if (!item) return jsonError(404, "Item not found.");

  const { data, error } = await auth.db
    .from("item_tldrs")
    .upsert(
      {
        item_id: itemId,
        user_id: auth.userId,
        tldr: parsed.data.tldr as unknown as Json,
        source: parsed.data.source,
        model: parsed.data.model,
        body_hash: parsed.data.body_hash,
      },
      { onConflict: "item_id" },
    )
    .select(TLDR_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === "23503") return jsonError(404, "Item not found.");
    if (error.code === "23514") return jsonError(400, "Invalid TL;DR.");
    console.error("Failed to save TL;DR:", error);
    return jsonError(500, "Something went wrong. Try again.");
  }
  const tldr = data ? rowToTldr(data as TldrRow) : null;
  if (!tldr) return jsonError(500, "Something went wrong. Try again.");
  return jsonData(tldr);
}

/** `DELETE /api/tldrs/<item id>`: removes the source's TL;DR. Deleting a missing one is fine. */
export async function DELETE(auth: RouteContext, _request: Request, params: Params) {
  const { itemId } = params;
  if (!idSchema.safeParse(itemId).success) return jsonError(400, "Invalid item ID");

  const { error } = await auth.db
    .from("item_tldrs")
    .delete()
    .eq("item_id", itemId)
    .eq("user_id", auth.userId);
  if (error) return jsonError(500, error.message);
  return jsonData({ item_id: itemId });
}
