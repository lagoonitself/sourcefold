import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGoogleClientEnv } from "@/lib/server-env";

export class DriveAuthError extends Error {
  constructor(message = "Google Drive authorization failed.") {
    super(message);
    this.name = "DriveAuthError";
  }
}

// The refresh token belongs to a different OAuth client than GOOGLE_CLIENT_ID.
// Reconnecting can't fix this; the server settings must match Supabase's Google provider.
export class DriveClientMismatchError extends Error {
  constructor() {
    super("GOOGLE_CLIENT_ID doesn't match the Google client Supabase signs in with.");
    this.name = "DriveClientMismatchError";
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

export function clearGoogleAccessToken(userId: string): void {
  tokenCache.delete(userId);
}

export async function getGoogleAccessToken(userId: string): Promise<string> {
  const cached = tokenCache.get(userId);
  const now = Date.now();
  // Reuse the token if it expires more than 5 minutes from now
  if (cached && cached.expiresAt - now > 5 * 60 * 1000) {
    return cached.token;
  }

  const admin = createAdminClient();
  const { data: tokenRow, error } = await admin
    .from("google_tokens")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !tokenRow?.refresh_token) {
    clearGoogleAccessToken(userId);
    throw new DriveAuthError("No Google Drive refresh token found.");
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = getGoogleClientEnv();

  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: tokenRow.refresh_token,
    grant_type: "refresh_token",
  });

  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Failed to connect to Google OAuth.");
  }

  let data: {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } = {};
  try {
    data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
  } catch {
    // Non-JSON response
  }

  if (data.error === "unauthorized_client" || data.error === "invalid_client") {
    clearGoogleAccessToken(userId);
    throw new DriveClientMismatchError();
  }

  if (response.status === 400 || response.status === 401 || data.error === "invalid_grant") {
    clearGoogleAccessToken(userId);
    throw new DriveAuthError(
      data.error_description || data.error || "Google Drive authorization expired or invalid.",
    );
  }

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || `Google OAuth returned status ${response.status}`,
    );
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  const expiresAt = Date.now() + expiresIn * 1000;
  tokenCache.set(userId, { token: data.access_token, expiresAt });

  return data.access_token;
}
