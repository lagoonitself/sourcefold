import { NextResponse } from "next/server";
import { jsonData, jsonError, requireApiUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const { db, userId } = auth;

  const { id } = await params;
  // Clients that can't follow a redirect into a browser (the desktop app) ask for the URL itself.
  const wantsJson =
    new URL(request.url).searchParams.get("format") === "json" ||
    (request.headers.get("accept") ?? "").includes("application/json");

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
    const driveUrl = `https://drive.google.com/file/d/${encodeURIComponent(item.drive_file_id)}/view`;
    return wantsJson ? jsonData({ url: driveUrl }) : NextResponse.redirect(driveUrl, 302);
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

  return wantsJson ? jsonData({ url: redirectUrl }) : NextResponse.redirect(redirectUrl, 302);
}
