import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { getAllowedEmails } from "@/lib/env";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { desktopCorsHeaders } from "@/lib/desktop-cors";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const cors = pathname.startsWith("/api/")
    ? desktopCorsHeaders(request.headers.get("origin"))
    : null;
  if (cors && request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  const authHeader = request.headers.get("authorization");
  if (pathname.startsWith("/api/") && authHeader && /^Bearer(\s+|$)/i.test(authHeader.trim())) {
    const response = NextResponse.next();
    for (const [name, value] of Object.entries(cors ?? {})) response.headers.set(name, value);
    return response;
  }

  const { response, user } = await updateSession(request);

  let allowedEmails: string[] = [];
  try {
    allowedEmails = getAllowedEmails();
  } catch {
    allowedEmails = [];
  }

  const userEmail = user?.email?.toLowerCase();
  const isAllowed = !!userEmail && allowedEmails.includes(userEmail);

  // If there is a user whose email is not allowed and path does not start with /login, /auth or /api
  if (
    user &&
    !isAllowed &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/auth") &&
    !pathname.startsWith("/api")
  ) {
    const redirectResponse = NextResponse.redirect(
      new URL("/login?error=not_allowed", request.url),
    );
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    const sbCookieNames = new Set<string>();
    for (const cookie of request.cookies.getAll()) {
      if (cookie.name.startsWith("sb-")) {
        sbCookieNames.add(cookie.name);
      }
    }
    for (const cookie of redirectResponse.cookies.getAll()) {
      if (cookie.name.startsWith("sb-")) {
        sbCookieNames.add(cookie.name);
      }
    }
    for (const name of sbCookieNames) {
      redirectResponse.cookies.delete(name);
    }
    return redirectResponse;
  }

  // No user and path does not start with /login, /auth or /api -> redirect to /login
  if (
    !user &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/auth") &&
    !pathname.startsWith("/api")
  ) {
    const loginUrl = new URL("/login", request.url);
    const returnPath = request.nextUrl.pathname + request.nextUrl.search;
    if (returnPath && returnPath !== "/") {
      loginUrl.searchParams.set("next", returnPath);
    }
    const redirectResponse = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }

  // User present and path is /login -> redirect to next or /
  if (user && isAllowed && pathname === "/login") {
    const rawNext = request.nextUrl.searchParams.get("next");
    const nextPath = safeRedirectPath(rawNext, "/");
    const redirectResponse = NextResponse.redirect(new URL(nextPath, request.url));
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
