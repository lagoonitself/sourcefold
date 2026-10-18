// Shared between the route modules (src/routes/**, owned by the routes agent) and the Drive
// modules (src/drive/**, owned by the Drive agent). Contract: docs/handoff-no-website.md.
import type { LocalApiDeps, SourcefoldSupabase } from "./types";

export interface RouteContext {
  deps: LocalApiDeps;
  supabase: SourcefoldSupabase;
  /** The signed-in user's id (from `supabase.auth.getUser()`, cached per session). */
  userId: string;
  /** Debounced Drive push a few seconds after a change; never two at once. */
  scheduleDrivePush(): void;
}

/** Path parameters, e.g. `{ id: "…" }` for `/api/items/[id]`. */
export type RouteParams = Record<string, string>;

export type RouteHandler = (
  ctx: RouteContext,
  request: Request,
  params: RouteParams,
) => Promise<Response>;
