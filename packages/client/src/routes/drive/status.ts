import { jsonData } from "../../http";
import type { RouteContext } from "../../context";

export async function GET(auth: RouteContext, request: Request) {
  const { db, userId } = auth;

  const connected = await auth.host.drive.isConnected(userId);

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
