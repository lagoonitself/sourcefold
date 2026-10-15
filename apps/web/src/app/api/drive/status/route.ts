import { jsonData, requireApiUser } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) {
    return auth.response;
  }
  const { db, userId } = auth;

  let connected = false;
  try {
    const admin = createAdminClient();
    const { data: tokenRow } = await admin
      .from("google_tokens")
      .select("refresh_token")
      .eq("user_id", userId)
      .maybeSingle();
    connected = Boolean(tokenRow?.refresh_token);
  } catch {
    connected = false;
  }

  const { data: unsavedCount } = await db.rpc("drive_unsaved_count", {
    p_user_id: userId,
  });
  const unsaved = typeof unsavedCount === "number" ? unsavedCount : 0;

  const { data: driveState } = await db
    .from("drive_state")
    .select("last_saved_at, root_folder_id")
    .eq("user_id", userId)
    .maybeSingle();

  return jsonData({
    unsaved,
    last_saved_at: driveState?.last_saved_at ?? null,
    root_folder_id: driveState?.root_folder_id ?? null,
    connected,
  });
}
