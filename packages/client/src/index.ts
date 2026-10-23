// The Sourcefold API, shared by the website (as its route handlers) and run inside the desktop
// app and the extension instead of on the website. Contract: docs/dev/handoff-no-website.md.
import { createClient, type SupportedStorage } from "@supabase/supabase-js";
import type { ClientConfig, LocalApi, LocalApiDeps, SourcefoldSupabase } from "./types";
import type { Database } from "./database.types";

export type * from "./types";
export type { RouteContext, RouteHandler, RouteModule, RouteParams } from "./context";
export type { DriveAccess, FetchUrl, Host } from "./host";
export { createDriveAccess, DRIVE_TOKEN_FUNCTION } from "./drive/token";
export { DriveAuthError, DriveClientMismatchError } from "./google/errors";
export { jsonData, jsonError } from "./http";

export const OAUTH_SCOPES = "https://www.googleapis.com/auth/drive.file";
export const OAUTH_QUERY_PARAMS = { access_type: "offline", prompt: "consent" } as const;

export function createSupabase(
  config: ClientConfig,
  storage?: SupportedStorage,
): SourcefoldSupabase {
  return createClient<Database>(config.supabaseUrl, config.supabasePublishableKey, {
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

/** The router over the route handlers; built once the routes have moved (step 2). */
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
