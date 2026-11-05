import { z } from "zod";
import { jsonData, jsonError } from "../../http";
import { readJsonBody } from "../../features/access/sharing";
import type { RouteContext } from "../../context";

const bodySchema = z.object({ enabled: z.boolean({ message: "enabled must be true or false." }) });

// Whether Sourcefold also copies the library to the user's Google Drive, and whether Drive is
// connected. A user without a Drive row yet has the backup on.
export async function GET(auth: RouteContext) {
  const { data, error } = await auth.db
    .from("drive_state")
    .select("backup_enabled")
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (error) {
    console.error("Failed to read the backup setting:", error);
    return jsonError(500, "Something went wrong. Try again.");
  }

  const connected = await auth.host.drive.isConnected(auth.userId);
  return jsonData({ enabled: data?.backup_enabled ?? true, connected });
}

export async function PUT(auth: RouteContext, request: Request) {
  if (auth.via === "token") {
    return jsonError(403, "Changing the backup needs the Sourcefold app or website.");
  }

  const json = await readJsonBody(request);
  if (!json) return jsonError(400, "Invalid JSON body");
  const parsed = bodySchema.safeParse(json.body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  const { error } = await auth.db.rpc("set_drive_backup", { p_enabled: parsed.data.enabled });
  if (error) {
    console.error("Failed to change the backup setting:", error);
    return jsonError(500, "Something went wrong. Try again.");
  }
  return jsonData({ enabled: parsed.data.enabled });
}
