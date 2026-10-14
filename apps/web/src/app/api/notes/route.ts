import { z } from "zod";
import { jsonData, jsonError, requireApiUser } from "@/lib/api";
import { ITEM_LIST_COLUMNS } from "@/features/items/item-columns";
import { invalidFolderMessage, nextPosition } from "@/features/capture/find-duplicate";

export const dynamic = "force-dynamic";

const createNoteSchema = z.object({
  folder_id: z.string().uuid("Invalid folder ID"),
  title: z
    .string()
    .trim()
    .min(1, "Title must be between 1 and 500 characters.")
    .max(500, "Title must be between 1 and 500 characters."),
  markdown: z
    .string()
    .max(200000, "Markdown must be at most 200000 characters.")
    .optional()
    .default(""),
});

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  const position = await nextPosition(auth.db, auth.userId, parsed.data.folder_id);

  const { data: noteItem, error: insertError } = await auth.db
    .from("items")
    .insert({
      user_id: auth.userId,
      folder_id: parsed.data.folder_id,
      kind: "note",
      title: parsed.data.title,
      status: "saved",
      source_url: null,
      canonical_url: null,
      meta: {},
      markdown: parsed.data.markdown,
      position,
    })
    .select(ITEM_LIST_COLUMNS)
    .single();

  if (insertError) {
    if (insertError.message.includes("invalid folder")) {
      return jsonError(400, invalidFolderMessage(insertError.message));
    }
    if (insertError.code === "23514") {
      return jsonError(400, "Note title or content is invalid.");
    }
    if (insertError.code === "23503") {
      return jsonError(400, "That folder no longer exists.");
    }
    if (insertError.code === "22P02") {
      return jsonError(400, "Invalid ID format.");
    }
    console.error("Failed to create note:", insertError);
    return jsonError(500, "Something went wrong. Try again.");
  }

  return jsonData(noteItem, 201);
}
