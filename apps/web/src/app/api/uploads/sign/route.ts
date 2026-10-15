import { z } from "zod";
import { jsonData, jsonError, requireApiUser } from "@/lib/api";
import { invalidFolderMessage } from "@/features/capture/find-duplicate";
import { toSafeFileName } from "@/features/items/safe-file-name";

export const dynamic = "force-dynamic";

const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

const signSchema = z.object({
  folder_id: z.string().uuid("Invalid folder ID."),
  file_name: z.string().min(1).max(300),
  mime_type: z.enum(ALLOWED_MIME_TYPES, { message: "Upload a PNG, JPEG, GIF or WebP image." }),
  size: z.number().int().min(1).max(10485760, "Images can be up to 10 MB."),
});

/**
 * Step 1 of an image upload for clients that have no browser session (the desktop app): returns
 * a one-time signed upload URL. The client PUTs the file there, then calls POST /api/uploads.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const { db, userId } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }

  const parsed = signSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body.");
  }
  const { folder_id, file_name } = parsed.data;

  const { data: folder, error: folderError } = await db
    .from("folders")
    .select("id, parent_id")
    .eq("id", folder_id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (folderError) {
    console.error("Failed to look up folder for image upload:", folderError);
    return jsonError(500, "Something went wrong. Try again.");
  }
  if (!folder) {
    return jsonError(400, invalidFolderMessage("invalid folder"));
  }
  if (folder.parent_id === null) {
    return jsonError(400, invalidFolderMessage("sources must be saved in a group"));
  }

  const itemId = crypto.randomUUID();
  const storagePath = `${userId}/${itemId}/${toSafeFileName(file_name)}`;

  const { data: signed, error: signError } = await db.storage
    .from("images")
    .createSignedUploadUrl(storagePath);

  if (signError || !signed) {
    console.error("Failed to create signed upload URL:", signError);
    return jsonError(500, "Couldn't start the upload. Try again.");
  }

  return jsonData({
    item_id: itemId,
    storage_path: storagePath,
    signed_url: signed.signedUrl,
    token: signed.token,
    // The public (publishable) key, which every browser session already has. Supabase Storage
    // may want it as an `apikey` header on the PUT.
    apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? null,
  });
}
