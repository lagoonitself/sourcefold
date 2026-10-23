import type { RouteContext } from "@sourcefold/client";
import { requireApiUser } from "@/lib/api";
import { webHost } from "@/lib/web-host";

// The website's API routes are shared handlers from packages/client (the desktop app and the
// extension run the same ones). This adds the website's sign-in: the session cookie or an `sf_`
// token, exactly as before.

type NextRouteContext = { params: Promise<Record<string, string>> };

export function webRoute<P extends Record<string, string>>(
  handler: (auth: RouteContext, request: Request, params: P) => Promise<Response>,
) {
  return async (request: Request, context?: NextRouteContext): Promise<Response> => {
    const auth = await requireApiUser(request);
    if ("response" in auth) return auth.response;
    const params = (context?.params ? await context.params : {}) as P;
    return handler(
      { db: auth.db, userId: auth.userId, via: auth.via, host: webHost },
      request,
      params,
    );
  };
}
