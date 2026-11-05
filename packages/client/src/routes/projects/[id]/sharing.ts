import { jsonData, jsonError } from "../../../http";
import {
  projectIdSchema,
  refuseToken,
  sharingError,
  type ProjectSharing,
} from "../../../features/access/sharing";
import type { RouteContext } from "../../../context";

// Who is in a project, and (for the owner) its invite codes.
export async function GET(auth: RouteContext, _request: Request, params: { id: string }) {
  const refused = refuseToken(auth);
  if (refused) return refused;
  if (!projectIdSchema.safeParse(params.id).success) return jsonError(400, "Invalid project ID.");

  const { data, error } = await auth.db.rpc("get_project_sharing", { p_project_id: params.id });
  if (error) return sharingError(error);
  if (!data) return jsonError(404, "Project not found.");
  return jsonData(data as unknown as ProjectSharing);
}
