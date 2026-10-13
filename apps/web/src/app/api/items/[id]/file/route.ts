import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { supabase, user } = auth;

  const { id } = await params;

  const { data: item, error } = await supabase
    .from("items")
    .select("id, kind, storage_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !item || item.kind !== "image" || !item.storage_path) {
    return jsonError(404, "Image not found.");
  }

  const { data: signedData, error: signError } = await supabase.storage
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
