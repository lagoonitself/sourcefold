import { z } from "zod";
import { jsonData, jsonError, requireUser } from "@/lib/api";
import { ITEM_LIST_COLUMNS } from "@/features/items/item-columns";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function toSafeFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  const lastDot = lower.lastIndexOf(".");
  let base: string;
  let ext: string;

  if (lastDot >= 0) {
    base = lower.slice(0, lastDot);
    ext = lower.slice(lastDot);
  } else {
    base = lower;
    ext = "";
  }

  // safe name: lowercase, keep [a-z0-9._-], collapse others to -, max 100 chars, keep extension
  let safeBase = base.replace(/[^a-z0-9._-]+/g, "-");
  const safeExt = ext.replace(/[^a-z0-9._-]+/g, "-");

  if (!safeBase) {
    safeBase = "image";
  }

  if (safeExt.length >= 100) {
    return safeExt.slice(0, 100);
  }

  const maxBaseLen = 100 - safeExt.length;
  if (safeBase.length > maxBaseLen) {
    safeBase = safeBase.slice(0, maxBaseLen);
  }

  return safeBase + safeExt;
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { supabase, user } = auth;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(400, "Invalid form data.");
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return jsonError(400, "File is required.");
  }

  const folderIdRaw = formData.get("folder_id");
  if (typeof folderIdRaw !== "string" || !folderIdRaw) {
    return jsonError(400, "Folder ID is required.");
  }

  const folderIdParsed = z.string().uuid("Invalid folder ID.").safeParse(folderIdRaw);
  if (!folderIdParsed.success) {
    return jsonError(400, folderIdParsed.error.issues[0]?.message ?? "Invalid folder ID.");
  }
  const folderId = folderIdParsed.data;

  if (file.size > MAX_FILE_SIZE) {
    return jsonError(413, "Images can be up to 10 MB.");
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return jsonError(415, "Upload a PNG, JPEG, GIF or WebP image.");
  }

  const titleRaw = formData.get("title");
  let title: string;
  if (typeof titleRaw === "string" && titleRaw.trim().length > 0) {
    title = titleRaw.trim();
  } else {
    const lastDot = file.name.lastIndexOf(".");
    const baseName = (lastDot >= 0 ? file.name.slice(0, lastDot) : file.name).trim();
    title = baseName || "Untitled image";
  }
  if (title.length > 500) {
    title = title.slice(0, 500);
  }

  const itemId = crypto.randomUUID();
  const safeName = toSafeFileName(file.name || "image");
  const storagePath = `${user.id}/${itemId}/${safeName}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await supabase.storage.from("images").upload(storagePath, buffer, {
    contentType: file.type,
    upsert: false,
  });

  if (uploadError) {
    return jsonError(500, uploadError.message);
  }

  const { data: siblings, error: sibError } = await supabase
    .from("items")
    .select("position")
    .eq("folder_id", folderId)
    .eq("user_id", user.id)
    .is("deleted_at", null);

  if (sibError) {
    await supabase.storage.from("images").remove([storagePath]);
    return jsonError(500, sibError.message);
  }

  const maxPosition =
    siblings && siblings.length > 0 ? Math.max(...siblings.map((item) => item.position)) : -1;
  const position = maxPosition + 1;

  const { data: item, error: insertError } = await supabase
    .from("items")
    .insert({
      id: itemId,
      user_id: user.id,
      folder_id: folderId,
      kind: "image",
      title,
      status: "saved",
      source_url: null,
      canonical_url: null,
      storage_path: storagePath,
      meta: {
        mime_type: file.type,
        file_name: file.name,
        size: file.size,
      },
      position,
    })
    .select(ITEM_LIST_COLUMNS)
    .single();

  if (insertError) {
    await supabase.storage.from("images").remove([storagePath]);
    if (insertError.message.includes("invalid folder")) {
      return jsonError(400, "That folder no longer exists.");
    }
    return jsonError(400, insertError.message);
  }

  return jsonData(item, 201);
}
