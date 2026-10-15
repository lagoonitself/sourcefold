/**
 * Pure helpers for the desktop "Connect" approval POST.
 */

/** True when the request comes from a page on our own origin (Origin, else Referer). */
export function isSameOriginRequest(request: Request): boolean {
  const ownOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === ownOrigin;

  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === ownOrigin;
  } catch {
    return false;
  }
}

/** The loopback URL the desktop app is listening on, with the sign-in result attached. */
export function buildCallbackTarget(
  callbackUrl: string,
  params: { state: string; token: string; email: string | null },
): string {
  const target = new URL(callbackUrl);
  target.searchParams.set("state", params.state);
  target.searchParams.set("token", params.token);
  if (params.email) {
    target.searchParams.set("email", params.email);
  }
  return target.toString();
}
