import { z } from "zod";
import {
  STAGED_MEDIA_BYTES,
  STAGED_MEDIA_TYPES,
  projectFileMediaType,
} from "@sourcefold/core/project-file";
import { jsonData, jsonError, requireApiUser } from "@/lib/api";
import { isSafeMediaName } from "@/features/project-file/media";
import { POST_MEDIA_BUCKET } from "@/features/drive/staged-media";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  file_name: z.string().min(1).max(300),
  mime_type: z.string().min(1).max(100),
  size: z.number().int().min(1),
});

/**
 * One image or GIF of a post from an imported project file: returns a signed upload URL in the
 * staging bucket. The next Drive save copies it into the post's `_files` folder and deletes it.
 * See docs/PROJECT-FILE.md.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const { db, userId } = auth;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError(400, "Invalid item ID");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body.");
  }
  const { file_name, mime_type, size } = parsed.data;
  if (!isSafeMediaName(file_name)) return jsonError(400, "Invalid file name.");
  // The type follows from the name, so a file can't be staged as something it isn't.
  const type = projectFileMediaType(file_name);
  if (type === null || type !== mime_type || !STAGED_MEDIA_TYPES.includes(type)) {
    return jsonError(400, "Only PNG, JPEG, GIF, WebP, AVIF and MP4 files can be added.");
  }
  if (size > STAGED_MEDIA_BYTES) return jsonError(413, "That file is over 25 MB.");

  const { data: item, error } = await db
    .from("items")
    .select("id, kind")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("Failed to look up the item for a post image:", error);
    return jsonError(500, "Something went wrong. Try again.");
  }
  if (!item || item.kind === "image") return jsonError(404, "Item not found.");

  const storagePath = `${userId}/${id}/${file_name}`;
  const { data: signed, error: signError } = await db.storage
    .from(POST_MEDIA_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signError || !signed) {
    console.error("Failed to create a signed upload URL for a post image:", signError);
    return jsonError(500, "Couldn't start the upload. Try again.");
  }

  return jsonData({
    item_id: id,
    storage_path: storagePath,
    signed_url: signed.signedUrl,
    apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? null,
  });
}
