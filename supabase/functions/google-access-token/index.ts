// Hands a signed-in Sourcefold user a short-lived Google Drive access token.
// Refreshing a Google token needs the OAuth client secret, which can't ship inside the open-source
// desktop app or extension, so this is the one piece of server code they use.
// Contract: docs/dev/handoff-no-website.md ("Drive access token").
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function fail(status: number, message: string, code?: string): Response {
  return json(status, { error: code ? { code, message } : { message } });
}

// Same rules as isEmailAllowed in apps/web/src/lib/env.ts; a missing ALLOWED_EMAIL means anyone.
function isEmailAllowed(email: string | null | undefined): boolean {
  const raw = Deno.env.get("ALLOWED_EMAIL") ?? "*";
  const allowed = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return allowed.includes("*") || allowed.includes(normalized);
}

const RECONNECT_MESSAGE = "Reconnect Google Drive: sign out and sign in again.";
const CLIENT_MISMATCH_MESSAGE =
  "GOOGLE_CLIENT_ID doesn't match the Google client Supabase signs in with.";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return fail(405, "Use POST.");
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const jwt = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return fail(401, "Sign in to Sourcefold first.");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
    return fail(500, "The Drive token service isn't set up yet.");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user) {
    return fail(401, "Your sign-in expired. Sign in again.");
  }
  if (!isEmailAllowed(user.email)) {
    return fail(403, "This account can't use Sourcefold.");
  }

  const { data: tokenRow, error: tokenError } = await admin
    .from("google_tokens")
    .select("refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();
  if (tokenError) {
    return fail(500, "Couldn't read the Google Drive connection.");
  }
  if (!tokenRow?.refresh_token) {
    return fail(401, RECONNECT_MESSAGE, "drive_reconnect");
  }

  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenRow.refresh_token,
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch {
    return fail(502, "Couldn't reach Google.");
  }

  let data: {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } = {};
  try {
    data = await response.json();
  } catch {
    // Non-JSON answer; handled below.
  }

  if (data.error === "unauthorized_client" || data.error === "invalid_client") {
    return fail(500, CLIENT_MISMATCH_MESSAGE, "drive_client_mismatch");
  }
  if (response.status === 400 || response.status === 401 || data.error === "invalid_grant") {
    return fail(401, RECONNECT_MESSAGE, "drive_reconnect");
  }
  if (!response.ok || !data.access_token) {
    return fail(502, data.error_description || data.error || `Google answered ${response.status}.`);
  }

  return json(200, {
    data: {
      access_token: data.access_token,
      expires_in: typeof data.expires_in === "number" ? data.expires_in : 3600,
    },
  });
});
