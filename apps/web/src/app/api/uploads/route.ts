import { z } from "zod";
import { jsonData, jsonError, requireUser } from "@/lib/api";
import { ITEM_LIST_COLUMNS } from "@/features/items/item-columns";

export const dynamic = "force-dynamic";

const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

const uploadSchema = z.object({
  item_id: z.string().uuid("Invalid item ID."),
  folder_id: z.string().uuid("Invalid folder ID."),
  storage_path: z.string().min(1).max(400),
  file_name: z.string().min(1).max(300),
  mime_type: z.enum(ALLOWED_MIME_TYPES),
  size: z.number().int().min(1).max(10485760),
  title: z.string().optional(),
});

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { supabase, user } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }

  const parsed = uploadSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  const {
    item_id,
    folder_id,
    storage_path,
    file_name,
    mime_type,
    size,
    title: titleInput,
  } = parsed.data;

  const expectedPrefix = `${user.id}/${item_id}/`;
  if (!storage_path.startsWith(expectedPrefix) || storage_path.includes("..")) {
    return jsonError(400, "Invalid upload path.");
  }

  const lastSegment = storage_path.split("/").pop();
  if (!lastSegment) {
    return jsonError(400, "Invalid upload path.");
  }

  const { data: files, error: listError } = await supabase.storage
    .from("images")
    .list(`${user.id}/${item_id}`);

  if (listError || !files || !files.some((f) => f.name === lastSegment)) {
    return jsonError(400, "Upload the image first.");
  }

  let title: string;
  if (titleInput && titleInput.trim().length > 0) {
    title = titleInput.trim();
  } else {
    const lastDot = file_name.lastIndexOf(".");
    const baseName = (lastDot >= 0 ? file_name.slice(0, lastDot) : file_name).trim();
    title = baseName || "Untitled image";
  }
  if (title.length > 500) {
    title = title.slice(0, 500);
  }

  const { data: siblings, error: sibError } = await supabase
    .from("items")
    .select("position")
    .eq("folder_id", folder_id)
    .eq("user_id", user.id)
    .is("deleted_at", null);

  if (sibError) {
    await supabase.storage.from("images").remove([storage_path]);
    return jsonError(500, sibError.message);
  }

  const maxPosition =
    siblings && siblings.length > 0 ? Math.max(...siblings.map((item) => item.position)) : -1;
  const position = maxPosition + 1;

  const { data: item, error: insertError } = await supabase
    .from("items")
    .insert({
      id: item_id,
      user_id: user.id,
      folder_id,
      kind: "image",
      title,
      status: "saved",
      source_url: null,
      canonical_url: null,
      storage_path,
      meta: {
        mime_type,
        file_name,
        size,
      },
      position,
    })
    .select(ITEM_LIST_COLUMNS)
    .single();

  if (insertError) {
    await supabase.storage.from("images").remove([storage_path]);
    if (insertError.message.includes("invalid folder")) {
      return jsonError(400, "That folder no longer exists.");
    }
    return jsonError(400, insertError.message);
  }

  return jsonData(item, 201);
}
