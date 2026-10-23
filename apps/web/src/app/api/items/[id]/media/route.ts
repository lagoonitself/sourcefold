import { z } from "zod";
import { jsonData, jsonError, requireApiUser } from "@/lib/api";
import { MAX_MEDIA_BYTES, loadItemMedia } from "@/features/project-file/media";
import { DriveAuthError, DriveClientMismatchError } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

// The files in the source's `_files` folder in Drive, for the project file.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError(400, "Invalid item ID");

  try {
    const media = await loadItemMedia(auth.db, auth.userId, id);
    if (!media.ok) return jsonError(media.status, media.message);
    return jsonData({
      files: media.files.map((f) => ({
        name: f.name,
        size: f.size,
        too_large: f.size > MAX_MEDIA_BYTES,
      })),
    });
  } catch (err) {
    if (err instanceof DriveAuthError || err instanceof DriveClientMismatchError) {
      return jsonError(
        502,
        "Couldn't read Google Drive. Reconnect Drive in the web app's Settings.",
      );
    }
    console.error("Failed to list a source's images:", err);
    return jsonError(500, "Couldn't read the images. Try again.");
  }
}
