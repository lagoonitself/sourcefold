import { z } from "zod";
import { jsonData, jsonError } from "../../../http";
import {
  inviteRoleSchema,
  projectIdSchema,
  readJsonBody,
  refuseToken,
  sharingError,
} from "../../../features/access/sharing";
import type { RouteContext } from "../../../context";

const bodySchema = z.object({ role: inviteRoleSchema });

// The invite code for a role, made on first use. Owner only.
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

  const { data, error } = await auth.db.rpc("get_project_invite", {
    p_project_id: params.id,
    p_role: parsed.data.role,
  });
  if (error) return sharingError(error);
  return jsonData({ code: data, role: parsed.data.role });
}

// Turns the link for a role off (`?role=editor`). Owner only.
export async function DELETE(auth: RouteContext, request: Request, params: { id: string }) {
  const refused = refuseToken(auth);
  if (refused) return refused;
  if (!projectIdSchema.safeParse(params.id).success) return jsonError(400, "Invalid project ID.");

  const role = inviteRoleSchema.safeParse(new URL(request.url).searchParams.get("role"));
  if (!role.success) return jsonError(400, "Query parameter 'role' must be editor or viewer.");

  const { error } = await auth.db.rpc("revoke_project_invite", {
    p_project_id: params.id,
    p_role: role.data,
  });
  if (error) return sharingError(error);
  return jsonData({ ok: true });
}
