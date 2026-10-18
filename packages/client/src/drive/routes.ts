// Owned by the Drive agent: handlers for /api/drive/save, /api/drive/status,
// /api/items/[id]/content and /api/items/[id]/file, plus the debounced push.
import type { RouteContext, RouteHandler } from "../context";

const notBuilt: RouteHandler = async () =>
  new Response(JSON.stringify({ error: { message: "Not built yet." } }), {
    status: 501,
    headers: { "Content-Type": "application/json" },
  });

export const driveRoutes = {
  /** POST /api/drive/save */
  save: notBuilt,
  /** GET /api/drive/status */
  status: notBuilt,
  /** GET /api/items/[id]/content (and ?format=docx) */
  itemContent: notBuilt,
  /** GET /api/items/[id]/file */
  itemFile: notBuilt,
} satisfies Record<string, RouteHandler>;

/** Returns a `scheduleDrivePush` for one signed-in session. */
export function createDrivePusher(_ctx: Omit<RouteContext, "scheduleDrivePush">): () => void {
  return () => {};
}
