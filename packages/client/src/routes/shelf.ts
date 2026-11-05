import { jsonData, jsonError } from "../http";
import { addShelfLinks, rowToShelfLink, SHELF_COLUMNS, shelfAddSchema } from "../features/shelf";
import type { RouteContext } from "../context";

/** `GET /api/shelf`: every link on the user's shelf, unsorted (the client sorts with `sortShelf`). */
export async function GET(auth: RouteContext) {
  const { data, error } = await auth.db
    .from("shelf_links")
    .select(SHELF_COLUMNS)
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(10000);
  if (error) return jsonError(500, error.message);
  return jsonData((data ?? []).map(rowToShelfLink));
}

/**
 * `POST /api/shelf`: adds one link (`ShelfLinkInput`) or several (`{ links }`). Links already on
 * the shelf are left as they are and come back in `existing`.
 */
export async function POST(auth: RouteContext, request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const parsed = shelfAddSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }
  try {
    return jsonData(await addShelfLinks(auth.db, auth.userId, parsed.data.links));
  } catch (error) {
    console.error("Failed to add shelf links:", error);
    return jsonError(500, "Couldn't add to your shelf. Try again.");
  }
}
