import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const { db, userId } = auth;

  const { id } = await params;

  const { data: item, error } = await db
    .from("items")
    .select("id, kind, storage_path, drive_file_id")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !item || item.kind !== "image") {
    return jsonError(404, "Image not found.");
  }

  // Once an image reaches Drive it's removed from Supabase, so open the Drive copy.
  if (!item.storage_path) {
    if (!item.drive_file_id) {
      return jsonError(404, "Image not found.");
    }
    return NextResponse.redirect(
      `https://drive.google.com/file/d/${encodeURIComponent(item.drive_file_id)}/view`,
      302,
    );
  }

  const { data: signedData, error: signError } = await db.storage
    .from("images")
    .createSignedUrl(item.storage_path, 300);

  if (signError || !signedData?.signedUrl) {
    return jsonError(404, "Image not found.");
  }

  const redirectUrl =
    signedData.signedUrl.startsWith("http://") || signedData.signedUrl.startsWith("https://")
      ? signedData.signedUrl
      : new URL(signedData.signedUrl, request.url).toString();

  return NextResponse.redirect(redirectUrl, 302);
}
