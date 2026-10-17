import { jsonData, jsonError, requireApiUser } from "@/lib/api";
import {
  HIGHLIGHT_COLUMNS,
  highlightIdSchema,
  highlightInputSchema,
  highlightNotePatchSchema,
  inputToRow,
  rowToHighlight,
} from "@/features/highlights";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

export async function PUT(request: Request, { params }: Params) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  if (!highlightIdSchema.safeParse(id).success) {
    return jsonError(400, "Invalid highlight ID");
  }

  const json = await readJson(request);
  if (!json.ok) return jsonError(400, "Invalid JSON body");

  const parsed = highlightInputSchema.safeParse(json.body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }
  if (parsed.data.id !== id) {
    return jsonError(400, "The highlight id in the body must match the URL.");
  }

  // An id owned by someone else looks exactly like an id that doesn't exist.
  const { data: existing, error: existingError } = await auth.db
    .from("highlights")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (existingError) return jsonError(500, existingError.message);
  if (existing && existing.user_id !== auth.userId) {
    return jsonError(404, "Highlight not found.");
  }

  const { data: item, error: itemError } = await auth.db
    .from("items")
    .select("id")
    .eq("id", parsed.data.item_id)
    .eq("user_id", auth.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (itemError) return jsonError(500, itemError.message);
  if (!item) return jsonError(404, "Item not found.");

  const row = inputToRow(parsed.data);
  const result = existing
    ? await auth.db
        .from("highlights")
        .update(row)
        .eq("id", id)
        .eq("user_id", auth.userId)
        .select(HIGHLIGHT_COLUMNS)
        .maybeSingle()
    : await auth.db
        .from("highlights")
        .insert({ ...row, id, user_id: auth.userId })
        .select(HIGHLIGHT_COLUMNS)
        .maybeSingle();

  if (result.error) {
    // The id was taken by another user between the check and the insert.
    if (result.error.code === "23505") return jsonError(404, "Highlight not found.");
    if (result.error.code === "23503") return jsonError(404, "Item not found.");
    if (result.error.code === "23514") return jsonError(400, "Invalid highlight data.");
    console.error("Failed to save highlight:", result.error);
    return jsonError(500, "Something went wrong. Try again.");
  }
  if (!result.data) return jsonError(404, "Highlight not found.");

  return jsonData(rowToHighlight(result.data));
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  if (!highlightIdSchema.safeParse(id).success) {
    return jsonError(400, "Invalid highlight ID");
  }

  const json = await readJson(request);
  if (!json.ok) return jsonError(400, "Invalid JSON body");

  const parsed = highlightNotePatchSchema.safeParse(json.body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  const { data, error } = await auth.db
    .from("highlights")
    .update({ note: parsed.data.note })
    .eq("id", id)
    .eq("user_id", auth.userId)
    .select(HIGHLIGHT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("Failed to update highlight note:", error);
    return jsonError(500, "Something went wrong. Try again.");
  }
  if (!data) return jsonError(404, "Highlight not found.");

  return jsonData(rowToHighlight(data));
}

export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  if (!highlightIdSchema.safeParse(id).success) {
    return jsonError(400, "Invalid highlight ID");
  }

  const { data, error } = await auth.db
    .from("highlights")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.userId)
    .select("id")
    .maybeSingle();

  if (error) return jsonError(500, error.message);
  if (!data) return jsonError(404, "Highlight not found.");

  return jsonData({ id });
}
