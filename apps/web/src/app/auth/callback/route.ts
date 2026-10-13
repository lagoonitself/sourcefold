import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAllowedEmails } from "@/lib/env";
import { safeRedirectPath } from "@/lib/safe-redirect";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const rawNext = requestUrl.searchParams.get("next");
  const next = safeRedirectPath(rawNext);

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
  }

  const userEmail = data.session.user.email?.toLowerCase();
  let allowedEmails: string[] = [];
  try {
    allowedEmails = getAllowedEmails();
  } catch (err) {
    console.error("Failed to read allowed emails:", err);
  }

  if (!userEmail || !allowedEmails.includes(userEmail)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=not_allowed", request.url));
  }

  const providerRefreshToken = data.session.provider_refresh_token;
  if (providerRefreshToken) {
    const { error: rpcError } = await supabase.rpc("save_google_refresh_token", {
      p_refresh_token: providerRefreshToken,
    });
    if (rpcError) {
      console.error("Failed to save Google refresh token:", rpcError);
    }
  }

  return NextResponse.redirect(new URL(next, request.url));
}
