import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isEmailAllowed, getPublicEnv } from "@/lib/env";
import { requireApiUser, type ApiUser } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";

/** `addedBy`: who to name on links this request queues ("Claude", "ChatGPT"). */
export type McpUser = ApiUser & { addedBy: string };
export type McpAuthResult = McpUser | { error: { status: number; message: string } };

const DEFAULT_ADDED_BY = "MCP";

// The OAuth client's registered name (Claude registers as "Claude", ChatGPT as "ChatGPT"), so the
// desktop app can say whose links it is saving. Best effort: never fails the request.
async function oauthClientName(clientId: string): Promise<string> {
  try {
    const { data } = await createAdminClient().auth.admin.oauth.getClient(clientId);
    const name = data?.client_name?.trim();
    return name ? name.slice(0, 100) : DEFAULT_ADDED_BY;
  } catch {
    return DEFAULT_ADDED_BY;
  }
}

function authorizationFailure(status: number, message: string): McpAuthResult {
  return { error: { status, message } };
}

async function apiAuthFailure(response: Response): Promise<McpAuthResult> {
  const payload = (await response
    .clone()
    .json()
    .catch(() => null)) as { error?: { message?: unknown } } | null;
  const message =
    typeof payload?.error?.message === "string"
      ? payload.error.message
      : "This access token isn't valid.";
  return authorizationFailure(response.status, message);
}

export async function authenticateMcpRequest(request: Request): Promise<McpAuthResult> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!bearer) {
    return authorizationFailure(401, "A Bearer access token is required.");
  }

  if (bearer.startsWith("sf_")) {
    const result = await requireApiUser(request);
    return "response" in result
      ? apiAuthFailure(result.response)
      : { ...result, addedBy: DEFAULT_ADDED_BY };
  }

  try {
    const env = getPublicEnv();
    const verifier = createSupabaseClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: claimsData, error: claimsError } = await verifier.auth.getClaims(bearer);
    const claims = claimsData?.claims;
    const claimUserId =
      typeof claims?.sub === "string"
        ? claims.sub
        : typeof claims?.user_id === "string"
          ? claims.user_id
          : null;

    if (claimsError || !claims || typeof claims.client_id !== "string" || !claimUserId) {
      return authorizationFailure(401, "This OAuth access token isn't valid.");
    }

    const { data, error } = await verifier.auth.getUser(bearer);
    if (error || !data.user || data.user.id !== claimUserId) {
      return authorizationFailure(401, "This OAuth access token isn't valid.");
    }

    let allowed = false;
    try {
      allowed = isEmailAllowed(data.user.email);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      return authorizationFailure(403, "This account can't use Sourcefold.");
    }

    const db = createSupabaseClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );

    return {
      db,
      userId: data.user.id,
      via: "session",
      addedBy: await oauthClientName(claims.client_id),
    };
  } catch {
    return authorizationFailure(500, "Sourcefold couldn't verify this access token.");
  }
}
