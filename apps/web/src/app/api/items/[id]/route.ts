import { z } from "zod";
import { jsonData, jsonError, requireApiUser } from "@/lib/api";
import { ITEM_LIST_COLUMNS } from "@/features/items/item-columns";
import { nextPosition } from "@/features/capture/find-duplicate";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid("Invalid item ID");

const patchItemSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title must be between 1 and 500 characters.")
      .max(500, "Title must be between 1 and 500 characters.")
      .optional(),
    folder_id: z.string().uuid("Invalid folder ID").optional(),
    note: z
      .string()
      .max(20000, "Note must be at most 20000 characters.")
      .nullable()
      .optional()
      // Only an explicit empty string clears the note; a missing key must stay undefined.
      .transform((val) => (val === "" ? null : val)),
    markdown: z.string().max(200000, "Markdown must be at most 200000 characters.").optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.folder_id !== undefined ||
      data.note !== undefined ||
      data.markdown !== undefined,
    { message: "At least one field must be provided to update." },
  );

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const idParsed = idSchema.safeParse(id);
  if (!idParsed.success) {
    return jsonError(400, "Invalid item ID");
  }

  const { data: item, error } = await auth.db
    .from("items")
    .select("id, kind, title, note, markdown, folder_id")
    .eq("id", id)
    .eq("user_id", auth.userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    return jsonError(500, error.message);
  }

  if (!item) {
    return jsonError(404, "Item not found.");
  }

  return jsonData(item);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const idParsed = idSchema.safeParse(id);
  if (!idParsed.success) {
    return jsonError(400, "Invalid item ID");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const parsed = patchItemSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  const { data: existing, error: existingError } = await auth.db
    .from("items")
    .select("id, kind, folder_id")
    .eq("id", id)
    .eq("user_id", auth.userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingError) {
    return jsonError(500, existingError.message);
  }

  if (!existing) {
    return jsonError(404, "Item not found.");
  }

  if (parsed.data.markdown !== undefined && existing.kind !== "note") {
    return jsonError(400, "Only notes have editable text.");
  }

  const updateData: {
    title?: string;
    folder_id?: string;
    note?: string | null;
    markdown?: string;
    position?: number;
  } = {};

  if (parsed.data.title !== undefined) {
    updateData.title = parsed.data.title;
  }
  if (parsed.data.note !== undefined) {
    updateData.note = parsed.data.note;
  }
  if (parsed.data.markdown !== undefined) {
    updateData.markdown = parsed.data.markdown;
  }

  if (parsed.data.folder_id !== undefined) {
    updateData.folder_id = parsed.data.folder_id;
    if (parsed.data.folder_id !== existing.folder_id) {
      updateData.position = await nextPosition(auth.db, auth.userId, parsed.data.folder_id);
    }
  }

  const { data: updatedItem, error: updateError } = await auth.db
    .from("items")
    .update(updateData)
    .eq("id", id)
    .eq("user_id", auth.userId)
    .is("deleted_at", null)
    .select(ITEM_LIST_COLUMNS)
    .maybeSingle();

  if (updateError) {
    if (updateError.message.includes("invalid folder")) {
      return jsonError(400, "That folder no longer exists.");
    }
    if (updateError.code === "23514") {
      return jsonError(400, "Invalid item data.");
    }
    if (updateError.code === "23503") {
      return jsonError(400, "That folder no longer exists.");
    }
    if (updateError.code === "22P02") {
      return jsonError(400, "Invalid ID format.");
    }
    console.error("Failed to update item:", updateError);
    return jsonError(500, "Something went wrong. Try again.");
  }

  if (!updatedItem) {
    return jsonError(404, "Item not found.");
  }

  return jsonData(updatedItem);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const idParsed = idSchema.safeParse(id);
  if (!idParsed.success) {
    return jsonError(400, "Invalid item ID");
  }

  const { data: deleted, error } = await auth.db
    .from("items")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", auth.userId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return jsonError(500, error.message);
  }

  if (!deleted) {
    return jsonError(404, "Item not found.");
  }

  return jsonData({ id });
}
