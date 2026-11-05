import { z } from "zod";
import { jsonData, jsonError } from "../../../../http";
import {
  inviteRoleSchema,
  projectIdSchema,
  readJsonBody,
  refuseToken,
  sharingError,
} from "../../../../features/access/sharing";
import type { RouteContext } from "../../../../context";

const bodySchema = z.object({ role: inviteRoleSchema });

// A new code for a role; the old one stops working. Owner only.
export async function POST(auth: RouteContext, request: Request, params: { id: string }) {
  const refused = refuseToken(auth);
  if (refused) return refused;
  if (!projectIdSchema.safeParse(params.id).success) return jsonError(400, "Invalid project ID.");

  const json = await readJsonBody(request);
  if (!json) return jsonError(400, "Invalid JSON body");
  const parsed = bodySchema.safeParse(json.body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  const { data, error } = await auth.db.rpc("reset_project_invite", {
    p_project_id: params.id,
    p_role: parsed.data.role,
  });
  if (error) return sharingError(error);
  return jsonData({ code: data, role: parsed.data.role });
}
