import { z } from "zod";
import { jsonData, jsonError } from "../../../http";
import { rowToShelfLink, SHELF_COLUMNS } from "../../../features/shelf";
import type { RouteContext } from "../../../context";

type Params = { id: string };

const idSchema = z.string().uuid();

/** `POST /api/shelf/<id>/open`: counts an open (for "most used") and stamps the time. */
export async function POST(auth: RouteContext, _request: Request, params: Params) {
  if (!idSchema.safeParse(params.id).success) return jsonError(400, "Invalid link ID");
  const { data: current, error: readError } = await auth.db
    .from("shelf_links")
    .select("open_count")
    .eq("id", params.id)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (readError) return jsonError(500, readError.message);
  if (!current) return jsonError(404, "Link not found.");

  // A lost count when two devices open the same link in the same instant is fine here.
  const { data, error } = await auth.db
    .from("shelf_links")
    .update({ open_count: current.open_count + 1, last_opened_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("user_id", auth.userId)
    .select(SHELF_COLUMNS)
    .maybeSingle();
  if (error) return jsonError(500, error.message);
  if (!data) return jsonError(404, "Link not found.");
  return jsonData(rowToShelfLink(data));
}
