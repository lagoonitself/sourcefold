import { z } from "zod";
import { jsonData, jsonError } from "../../../http";
import { refuseToken, sharingError } from "../../../features/access/sharing";
import type { RouteContext } from "../../../context";

const codeSchema = z.string().trim().min(1).max(40);

// Joins the project the code belongs to (nothing changes if you're already in it).
export async function POST(auth: RouteContext, _request: Request, params: { code: string }) {
  const refused = refuseToken(auth);
  if (refused) return refused;
  const code = codeSchema.safeParse(params.code);
  if (!code.success) return jsonError(404, "This invite link doesn't work. Ask for a new one.");

  const { data, error } = await auth.db.rpc("accept_project_invite", { p_code: code.data });
  if (error) return sharingError(error);
  return jsonData({ project_id: data });
}
