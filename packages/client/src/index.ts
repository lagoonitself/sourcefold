// The Sourcefold API, run inside the desktop app and the extension instead of on the website.
// Contract: docs/dev/handoff-no-website.md. The exported names and shapes are fixed.
import { createClient, type SupportedStorage } from "@supabase/supabase-js";
import type { ClientConfig, LocalApi, LocalApiDeps, SourcefoldSupabase } from "./types";
import type { Database } from "./database.types";

export type * from "./types";
export type { RouteContext, RouteHandler, RouteParams } from "./context";
export { createDriveTokenSource, DRIVE_TOKEN_FUNCTION } from "./drive/token";

export const OAUTH_SCOPES = "https://www.googleapis.com/auth/drive.file";
export const OAUTH_QUERY_PARAMS = { access_type: "offline", prompt: "consent" } as const;

export function createSupabase(
  config: ClientConfig,
  storage?: SupportedStorage,
): SourcefoldSupabase {
  return createClient<Database>(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "sourcefold:auth",
      ...(storage ? { storage } : {}),
    },
  });
}

/** Owned by the routes agent: the router over src/routes/** and src/drive/routes.ts. */
export function createLocalApi(_deps: LocalApiDeps): LocalApi {
  return {
    async fetch(path: string) {
      return new Response(JSON.stringify({ error: { message: `Not built yet: ${path}` } }), {
        status: 501,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
}
