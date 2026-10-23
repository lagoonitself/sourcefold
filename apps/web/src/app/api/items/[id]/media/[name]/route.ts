import { z } from "zod";
import { jsonError, requireApiUser } from "@/lib/api";
import { downloadFileBytes } from "@/lib/google/drive";
import { MAX_MEDIA_BYTES, isSafeMediaName, loadItemMedia } from "@/features/project-file/media";
import { DriveAuthError, DriveClientMismatchError } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

// One image or GIF from the source's `_files` folder in Drive, up to 4 MB.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { id, name } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError(400, "Invalid item ID");
  if (!isSafeMediaName(name)) return jsonError(400, "Invalid file name.");

  try {
    const media = await loadItemMedia(auth.db, auth.userId, id);
    if (!media.ok) return jsonError(media.status, media.message);
    const file = media.files.find((f) => f.name === name);
    if (!file) return jsonError(404, "File not found.");
    if (file.size > MAX_MEDIA_BYTES) return jsonError(413, "That file is over 4 MB.");

    const bytes = await downloadFileBytes(media.token, file.id);
    if (!bytes) return jsonError(404, "File not found.");
    if (bytes.byteLength > MAX_MEDIA_BYTES) return jsonError(413, "That file is over 4 MB.");
    return new Response(Buffer.from(bytes), {
      headers: { "Content-Type": file.mimeType, "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof DriveAuthError || err instanceof DriveClientMismatchError) {
      return jsonError(
        502,
        "Couldn't read Google Drive. Reconnect Drive in the web app's Settings.",
      );
    }
    console.error("Failed to read a source's image:", err);
    return jsonError(500, "Couldn't read the image. Try again.");
  }
}
