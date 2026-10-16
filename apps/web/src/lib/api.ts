import { NextResponse } from "next/server";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/env";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashApiToken } from "@/lib/api-tokens";

export function jsonData<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: { message } }, { status });
}

export type AuthSuccess = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email: string | null };
};

export type AuthFailure = {
  response: NextResponse<{ error: { message: string } }>;
};

export type AuthResult = AuthSuccess | AuthFailure;

export async function requireUser(): Promise<AuthResult> {
  const user = await getSessionUser();

  if (!user) {
    return { response: jsonError(401, "Sign in to continue.") };
  }

  let allowed: boolean;
  try {
    allowed = isEmailAllowed(user.email);
  } catch {
    allowed = false;
  }
  if (!allowed) {
    return { response: jsonError(403, "This account can't use Sourcefold.") };
  }

  const supabase = await createClient();
  return { supabase, user };
}

export type ApiUser = {
  // RLS client for a web session; admin client (RLS bypassed) for an extension token.
  // Always filter by userId and set user_id on inserts so both paths behave the same.
  db: SupabaseClient<Database>;
  userId: string;
  via: "session" | "token";
};

export type ApiAuthResult = ApiUser | AuthFailure;

// Accepts either the web session cookie or an extension token (Authorization: Bearer sf_...).
export async function requireApiUser(request: Request): Promise<ApiAuthResult> {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(\S+)$/i);

  if (!match?.[1]) {
    const auth = await requireUser();
    if ("response" in auth) return auth;
    return { db: auth.supabase, userId: auth.user.id, via: "session" };
  }

  let admin: SupabaseClient<Database>;
  try {
    admin = createAdminClient();
  } catch {
    return { response: jsonError(500, "The server is missing SUPABASE_SECRET_KEY.") };
  }

  const { data: token, error } = await admin
    .from("api_tokens")
    .select("id, user_id")
    .eq("token_hash", hashApiToken(match[1]))
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !token) {
    return {
      response: jsonError(401, "This access token isn't valid. Create a new one in Settings."),
    };
  }

  // Verify that the token owner is still allowed by ALLOWED_EMAIL
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(token.user_id);
  let allowed = false;
  try {
    allowed = !userError && isEmailAllowed(userData?.user?.email);
  } catch {
    allowed = false;
  }
  if (!allowed) {
    return { response: jsonError(403, "This account can't use Sourcefold.") };
  }

  await admin
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", token.id);

  return { db: admin, userId: token.user_id, via: "token" };
}
