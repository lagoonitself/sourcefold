import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAllowedEmails } from "@/lib/env";
import type { User } from "@supabase/supabase-js";

export function jsonData<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: { message } }, { status });
}

export type AuthSuccess = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
};

export type AuthFailure = {
  response: NextResponse<{ error: { message: string } }>;
};

export type AuthResult = AuthSuccess | AuthFailure;

export async function requireUser(): Promise<AuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { response: jsonError(401, "Sign in to continue.") };
  }

  let allowedEmails: string[];
  try {
    allowedEmails = getAllowedEmails();
  } catch {
    return { response: jsonError(403, "This account can't use Sourcefold.") };
  }

  const email = user.email?.trim().toLowerCase();
  if (!email || !allowedEmails.includes(email)) {
    return { response: jsonError(403, "This account can't use Sourcefold.") };
  }

  return { supabase, user };
}
