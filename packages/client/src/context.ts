// What every route handler gets. The website builds it from its session or `sf_` token
// (apps/web/src/lib/web-route.ts); the apps build it from their Supabase sign-in (router.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { Host } from "./host";

export interface RouteContext {
  /**
   * RLS client for a signed-in session; on the website, the admin client (RLS bypassed) for an
   * `sf_` token. Always filter by `userId` and set `user_id` on inserts so both behave the same.
   */
  db: SupabaseClient<Database>;
  userId: string;
  via: "session" | "token";
  host: Host;
}

/** Path parameters, e.g. `{ id: "…" }` for `/api/items/[id]`. */
export type RouteParams = Record<string, string>;

export type RouteHandler = (
  ctx: RouteContext,
  request: Request,
  params: RouteParams,
) => Promise<Response>;

/**
 * One route file: its handlers by HTTP method. Each handler types its own params
 * (`{ id: string }`); the router only calls it for a path that matched its pattern.
 */
export type RouteModule = Partial<
  Record<
    "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    (ctx: RouteContext, request: Request, params: never) => Promise<Response>
  >
>;
