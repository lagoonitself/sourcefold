// Owned by the Drive agent. Skeleton: calls the `google-access-token` Edge Function and caches.
import type { ClientConfig, SourcefoldSupabase } from "../types";

export const DRIVE_TOKEN_FUNCTION = "google-access-token";

export function createDriveTokenSource(
  _supabase: SourcefoldSupabase,
  _config: ClientConfig,
): () => Promise<string> {
  return async () => {
    throw new Error("createDriveTokenSource is not built yet.");
  };
}
