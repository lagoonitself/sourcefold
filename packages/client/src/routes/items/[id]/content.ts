import { z } from "zod";
import { jsonError } from "../../../http";
import { getItemContent, getItemDocx } from "../../../features/mirror/item-content";
import { DriveAuthError, DriveClientMismatchError } from "../../../google/errors";
import type { RouteContext } from "../../../context";

const idSchema = z.string().uuid("Invalid item ID");

// The item's file as Drive holds it: Markdown with front matter, or the image bytes.
// `?format=docx` is the Word copy of a text file, exported from its Google Doc.
export async function GET(auth: RouteContext, request: Request, params: { id: string }) {
  const { id } = params;
  if (!idSchema.safeParse(id).success) return jsonError(400, "Invalid item ID");

  const wantsDocx = new URL(request.url).searchParams.get("format") === "docx";

  try {
    const content = wantsDocx
      ? await getItemDocx(auth.db, auth.userId, id, auth.host.drive)
      : await getItemContent(auth.db, auth.userId, id, auth.host.drive);
    if (!content.ok) {
      // The desktop tells "try again later" from a real failure by the code.
      if (content.code) {
        return Response.json(
          { error: { message: content.message, code: content.code } },
          { status: content.status },
        );
      }
      return jsonError(content.status, content.message);
    }
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
