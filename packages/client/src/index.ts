// The Sourcefold API, shared by the website (as its route handlers) and run inside the desktop
// app and the extension instead of on the website. Contract: docs/dev/handoff-no-website.md.
import { createClient, type SupportedStorage } from "@supabase/supabase-js";
import type { ClientConfig, SourcefoldSupabase } from "./types";
import type { Database } from "./database.types";

export type * from "./types";
export type { RouteContext, RouteHandler, RouteModule, RouteParams } from "./context";
export type { DriveAccess, FetchUrl, Host } from "./host";
export { createDriveAccess, DRIVE_TOKEN_FUNCTION } from "./drive/token";
export { DriveAuthError, DriveClientMismatchError } from "./google/errors";
export { jsonData, jsonError } from "./http";
export {
  createLocalApi,
  dispatchRoute,
  matchRoute,
  LOCAL_ROUTES,
  type LocalApiWithDrive,
} from "./router";
export { createDrivePusher, DRIVE_PUSH_DELAY_MS, type DrivePusher } from "./drive/push";

export {
  browserSyncEnvironment,
  createLiveSync,
  parseSyncMessage,
  supabaseSyncTransport,
  syncTopic,
  SYNC_EVENT,
  type ChannelStatus,
  type LiveSync,
  type LiveSyncEnvironment,
  type LiveSyncOptions,
  type LiveSyncState,
  type LiveSyncTransport,
  type RealtimeClient,
  type SyncBatch,
  type SyncMessage,
} from "./live-sync";

/** Request header naming the device that made a write (see notify_sync in the database). */
export const DEVICE_HEADER = "x-sourcefold-device";

export const OAUTH_SCOPES = "https://www.googleapis.com/auth/drive.file";
export const OAUTH_QUERY_PARAMS = { access_type: "offline", prompt: "consent" } as const;

export function createSupabase(
  config: ClientConfig,
  storage?: SupportedStorage,
  options: { deviceId?: string | null } = {},
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
    // Live sync tells each device which changes were its own (docs/dev/PLAN-sync.md).
    ...(options.deviceId ? { global: { fetch: withDeviceHeader(options.deviceId) } } : {}),
  });
}

/**
 * Adds the device header to database requests (`/rest/v1/`) only. Other Supabase services, such
 * as the Drive token Edge Function, allow a fixed list of headers and would refuse it.
 */
export function withDeviceHeader(
  deviceId: string,
  baseFetch: typeof fetch = (...args) => fetch(...args),
): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/\/rest\/v1\//.test(url)) return baseFetch(input, init);
    const headers = new Headers(
      init?.headers ??
        (typeof input === "object" && "headers" in input ? input.headers : undefined),
    );
    headers.set(DEVICE_HEADER, deviceId);
    return baseFetch(input, { ...init, headers });
  };
}

export type { ContentStore, StoredContent } from "./host";
export { createWorkerContentStore, ContentStoreError } from "./features/content/worker-store";
export { loadItemBody, loadItemFile, ContentNotReadyError } from "./features/content/body";
export { runContentBatch, type ContentBatchResult } from "./features/content/run-content-batch";
