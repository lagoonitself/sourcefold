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

type Params = { id: string; userId: string };

const userIdSchema = z.string().uuid("Invalid user ID.");
const bodySchema = z.object({ role: inviteRoleSchema });

// Changes a member's role. Owner only.
export async function PATCH(auth: RouteContext, request: Request, params: Params) {
  const refused = refuseToken(auth);
  if (refused) return refused;
  if (!projectIdSchema.safeParse(params.id).success) return jsonError(400, "Invalid project ID.");
  if (!userIdSchema.safeParse(params.userId).success) return jsonError(400, "Invalid user ID.");

  const json = await readJsonBody(request);
  if (!json) return jsonError(400, "Invalid JSON body");
  const parsed = bodySchema.safeParse(json.body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  const { error } = await auth.db.rpc("set_project_member_role", {
    p_project_id: params.id,
    p_user_id: params.userId,
    p_role: parsed.data.role,
  });
  if (error) return sharingError(error);
  return jsonData({ ok: true });
}

// The owner removes someone; anyone can remove themself (leave the project).
export async function DELETE(auth: RouteContext, _request: Request, params: Params) {
  const refused = refuseToken(auth);
  if (refused) return refused;
  if (!projectIdSchema.safeParse(params.id).success) return jsonError(400, "Invalid project ID.");
  if (!userIdSchema.safeParse(params.userId).success) return jsonError(400, "Invalid user ID.");

  const { error } = await auth.db.rpc("remove_project_member", {
    p_project_id: params.id,
    p_user_id: params.userId,
  });
  if (error) return sharingError(error);
  return jsonData({ ok: true });
}
