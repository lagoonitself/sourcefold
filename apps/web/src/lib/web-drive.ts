import "server-only";
import type { DriveAccess, FetchUrl } from "@sourcefold/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearGoogleAccessToken, getGoogleAccessToken } from "@/lib/google/oauth";
import { publicFetch } from "@/lib/public-fetch";

// The website's Drive access and link fetching, for the shared API code in packages/client.

export const webDriveAccess: DriveAccess = {
  getAccessToken: (userId) => getGoogleAccessToken(userId),
  clearAccessToken: (userId) => clearGoogleAccessToken(userId),
  async isConnected(userId) {
    try {
      const admin = createAdminClient();
      const { data: tokenRow } = await admin
        .from("google_tokens")
        .select("refresh_token")
        .eq("user_id", userId)
        .maybeSingle();
      return Boolean(tokenRow?.refresh_token);
    } catch {
      return false;
    }
  },
};

/** Anyone can sign up, so links people give us never reach private addresses. */
export const webFetchUrl: FetchUrl = (url, init) => publicFetch(url, init);
