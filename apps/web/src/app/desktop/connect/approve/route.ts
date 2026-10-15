import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { generateApiToken, hashApiToken } from "@/lib/api-tokens";
import { buildCallbackTarget, isSameOriginRequest } from "@/features/desktop-connect/approve";
import { validateConnectParams } from "@/features/desktop-connect/validation";

export const dynamic = "force-dynamic";

// A plain form POST answered with a 303 redirect. A server action can't do this: its
// redirects are read by the Next.js client router, which expects a same-app response.
function redirectTo(url: URL | string) {
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return new NextResponse("This request didn't come from Sourcefold.", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const auth = await requireUser();
  if ("response" in auth) {
    return redirectTo(new URL("/login", request.url));
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirectTo(new URL("/desktop/connect", request.url));
  }

  const callback = form.get("callback");
  const state = form.get("state");
  const validation = validateConnectParams(
    typeof callback === "string" ? callback : null,
    typeof state === "string" ? state : null,
  );
  if (!validation.valid) {
    return redirectTo(new URL("/desktop/connect", request.url));
  }

  const rawToken = generateApiToken();
  const { data, error } = await auth.supabase
    .from("api_tokens")
    .insert({
      name: "Sourcefold Desktop",
      token_hash: hashApiToken(rawToken),
      user_id: auth.user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    const retry = new URL("/desktop/connect", request.url);
    retry.searchParams.set("callback", validation.callbackUrl);
    retry.searchParams.set("state", validation.state);
    retry.searchParams.set("error", "failed");
    return redirectTo(retry);
  }

  return redirectTo(
    buildCallbackTarget(validation.callbackUrl, {
      state: validation.state,
      token: rawToken,
      email: auth.user.email,
    }),
  );
}
