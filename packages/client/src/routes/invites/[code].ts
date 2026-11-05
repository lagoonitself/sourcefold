import { z } from "zod";
import { jsonData, jsonError } from "../../http";
import { refuseToken, sharingError, type InvitePreview } from "../../features/access/sharing";
import type { RouteContext } from "../../context";

const codeSchema = z.string().trim().min(1).max(40);
const BAD_INVITE = "This invite link doesn't work. Ask for a new one.";

// What an invite link or code would join, before joining.
export async function GET(auth: RouteContext, _request: Request, params: { code: string }) {
  const refused = refuseToken(auth);
  if (refused) return refused;
  const code = codeSchema.safeParse(params.code);
  if (!code.success) return jsonError(404, BAD_INVITE);

  const { data, error } = await auth.db.rpc("preview_project_invite", { p_code: code.data });
  if (error) return sharingError(error);
  if (!data) return jsonError(404, BAD_INVITE);
  return jsonData(data as unknown as InvitePreview);
}
