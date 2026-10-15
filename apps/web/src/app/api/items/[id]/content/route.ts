import { z } from "zod";
import { jsonError, requireApiUser } from "@/lib/api";
import { getItemContent } from "@/features/mirror/item-content";
import { DriveAuthError, DriveClientMismatchError } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid("Invalid item ID");

// The item's file as Drive holds it: Markdown with front matter, or the image bytes.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  if (!idSchema.safeParse(id).success) return jsonError(400, "Invalid item ID");

  try {
    const content = await getItemContent(auth.db, auth.userId, id);
    if (!content.ok) return jsonError(content.status, content.message);
    const body = typeof content.body === "string" ? content.body : Buffer.from(content.body);
    return new Response(body, {
      headers: { "Content-Type": content.mimeType, "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof DriveAuthError || err instanceof DriveClientMismatchError) {
      return jsonError(
        502,
        "Couldn't read Google Drive. Reconnect Drive in the web app's Settings.",
      );
    }
    return jsonError(500, err instanceof Error ? err.message : "Couldn't read the file.");
  }
}
