import { jsonData, requireUser } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) {
    return auth.response;
  }
  const { supabase, user } = auth;

  let connected = false;
  try {
    const admin = createAdminClient();
    const { data: tokenRow } = await admin
      .from("google_tokens")
      .select("refresh_token")
      .eq("user_id", user.id)
      .maybeSingle();
    connected = Boolean(tokenRow?.refresh_token);
  } catch {
    connected = false;
  }

  const { data: unsavedCount } = await supabase.rpc("drive_unsaved_count");
  const unsaved = typeof unsavedCount === "number" ? unsavedCount : 0;

  const { data: driveState } = await supabase
    .from("drive_state")
    .select("last_saved_at, root_folder_id")
    .eq("user_id", user.id)
    .maybeSingle();

  return jsonData({
    unsaved,
    last_saved_at: driveState?.last_saved_at ?? null,
    root_folder_id: driveState?.root_folder_id ?? null,
    connected,
  });
}
