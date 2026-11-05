import { jsonData, jsonError } from "../../../http";
import { ContentNotReadyError, loadItemFile } from "../../../features/content/body";
import type { RouteContext } from "../../../context";

/** Not Buffer: this route also runs in the desktop app, which has no Node globals. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function GET(auth: RouteContext, request: Request, params: { id: string }) {
  const { db, userId } = auth;

  const { id } = params;
  // Clients that can't follow a redirect into a browser (the desktop app) ask for the URL itself.
  const wantsJson =
    new URL(request.url).searchParams.get("format") === "json" ||
    (request.headers.get("accept") ?? "").includes("application/json");

  const { data: item, error } = await db
    .from("items")
    .select("id, kind, storage_path, drive_file_id, content_sha256, user_id, meta")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !item || item.kind !== "image") {
    return jsonError(404, "Image not found.");
  }

  // Once an image reaches R2 it's removed from Supabase. R2 needs a sign-in header, so the bytes
  // come back directly (as a data: URL for clients that asked for JSON).
  if (!item.storage_path && item.content_sha256 && auth.host.content) {
    try {
      const file = await loadItemFile(db, auth.host, userId, item);
      if (file) {
        const meta = (item.meta ?? {}) as Record<string, unknown>;
        const mimeType =
          typeof meta.mime_type === "string"
            ? meta.mime_type
            : (file.mimeType ?? "application/octet-stream");
        if (wantsJson) return jsonData({ url: `data:${mimeType};base64,${toBase64(file.bytes)}` });
        return new Response(new Uint8Array(file.bytes), {
          headers: { "Content-Type": mimeType, "Cache-Control": "no-store" },
        });
      }
    } catch (err) {
      if (err instanceof ContentNotReadyError) {
        return Response.json(
          { error: { message: err.message, code: "not_ready" } },
          { status: 409 },
        );
      }
      throw err;
    }
  }

  // Older images that reached Drive are removed from Supabase, so open the Drive copy.
  if (!item.storage_path) {
    if (!item.drive_file_id || item.user_id !== userId) {
      return jsonError(404, "Image not found.");
    }
    const driveUrl = `https://drive.google.com/file/d/${encodeURIComponent(item.drive_file_id)}/view`;
    return wantsJson ? jsonData({ url: driveUrl }) : Response.redirect(driveUrl, 302);
  }

  const { data: signedData, error: signError } = await db.storage
    .from("images")
    .createSignedUrl(item.storage_path, 60 * 60 * 24 * 7);

  if (signError || !signedData?.signedUrl) {
    return jsonError(404, "Image not found.");
  }

  const redirectUrl =
    signedData.signedUrl.startsWith("http://") || signedData.signedUrl.startsWith("https://")
      ? signedData.signedUrl
      : new URL(signedData.signedUrl, request.url).toString();

  return wantsJson ? jsonData({ url: redirectUrl }) : Response.redirect(redirectUrl, 302);
}
