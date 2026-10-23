import { z } from "zod";
import { type AuthorType, isSourceCaptureKind } from "@sourcefold/core";
import { jsonData, jsonError } from "../../http";
import { ITEM_LIST_COLUMNS } from "../../features/items/item-columns";
import { invalidFolderMessage, nextPosition } from "../../features/capture/find-duplicate";
import { researchPatchShape } from "../../features/research/item-fields";
import type { RouteContext } from "../../context";

const idSchema = z.string().uuid("Invalid item ID");

const NOTE_MARKDOWN_MAX = 200000;
// A long Grokipedia article is about 200 KB and a YouTube transcript can be more.
const SOURCE_MARKDOWN_MAX = 2000000;

/** A source's text is the page as it was saved, and the user may cut parts out of it. */
function hasEditableSourceText(kind: string): boolean {
  return (
    kind === "grokipedia" ||
    kind === "wikipedia" ||
    kind === "substack" ||
    isSourceCaptureKind(kind)
  );
}

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
    markdown: z
      .string()
      .max(SOURCE_MARKDOWN_MAX, `Text must be at most ${SOURCE_MARKDOWN_MAX} characters.`)
      .optional(),
    ...researchPatchShape,
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.folder_id !== undefined ||
      data.note !== undefined ||
      data.markdown !== undefined ||
      data.triage !== undefined ||
      data.tags !== undefined ||
      data.summary !== undefined ||
      data.author !== undefined ||
      data.author_type !== undefined,
    { message: "At least one field must be provided to update." },
  );

const ITEM_GET_COLUMNS =
  "id, kind, title, note, markdown, folder_id, triage, tags, summary, author, author_type" as const;

export async function GET(auth: RouteContext, request: Request, params: { id: string }) {
  const { id } = params;
  const idParsed = idSchema.safeParse(id);
  if (!idParsed.success) {
    return jsonError(400, "Invalid item ID");
  }

  const { data: item, error } = await auth.db
    .from("items")
    .select(ITEM_GET_COLUMNS)
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

export async function PATCH(auth: RouteContext, request: Request, params: { id: string }) {
  const { id } = params;
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

  if (parsed.data.markdown !== undefined) {
    if (existing.kind === "note") {
      if (parsed.data.markdown.length > NOTE_MARKDOWN_MAX) {
        return jsonError(400, `Markdown must be at most ${NOTE_MARKDOWN_MAX} characters.`);
      }
    } else if (!hasEditableSourceText(existing.kind)) {
      return jsonError(400, "This source's text can't be edited.");
    }
  }

  const updateData: {
    title?: string;
    folder_id?: string;
    note?: string | null;
    markdown?: string;
    position?: number;
    triage?: "keep" | "maybe" | "cut" | null;
    tags?: string[];
    summary?: string | null;
    author?: string | null;
    author_type?: AuthorType | null;
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
  if (parsed.data.triage !== undefined) {
    updateData.triage = parsed.data.triage;
  }
  if (parsed.data.tags !== undefined) {
    updateData.tags = parsed.data.tags;
  }
  if (parsed.data.summary !== undefined) {
    updateData.summary = parsed.data.summary;
  }
  if (parsed.data.author !== undefined) {
    updateData.author = parsed.data.author;
  }
  if (parsed.data.author_type !== undefined) {
    updateData.author_type = parsed.data.author_type;
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
      return jsonError(400, invalidFolderMessage(updateError.message));
    }
    if (updateError.code === "23505") {
      return jsonError(409, "That group already has this link.");
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

  // The new text waits in Supabase until it reaches Drive, like a source that was just saved.
  if (parsed.data.markdown !== undefined && existing.kind !== "note") {
    auth.host.scheduleDrivePush(auth.userId);
  }

  return jsonData(updatedItem);
}

export async function DELETE(auth: RouteContext, request: Request, params: { id: string }) {
  const { id } = params;
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
