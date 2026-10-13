import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGoogleClientEnv } from "@/lib/server-env";

export class DriveAuthError extends Error {
  constructor(message = "Google Drive authorization failed.") {
    super(message);
    this.name = "DriveAuthError";
  }
}

export async function getGoogleAccessToken(userId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: tokenRow, error } = await admin
    .from("google_tokens")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !tokenRow?.refresh_token) {
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

  let data: { access_token?: string; error?: string; error_description?: string } = {};
  try {
    data = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
  } catch {
    // Non-JSON response
  }

  if (response.status === 400 || response.status === 401 || data.error === "invalid_grant") {
    throw new DriveAuthError(
      data.error_description || data.error || "Google Drive authorization expired or invalid.",
    );
  }

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || `Google OAuth returned status ${response.status}`,
    );
  }

  return data.access_token;
}
