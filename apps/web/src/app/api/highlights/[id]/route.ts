import * as route from "@sourcefold/client/routes/highlights/[id]";
import { webRoute } from "@/lib/web-route";

export const dynamic = "force-dynamic";

export const PUT = webRoute(route.PUT);
export const PATCH = webRoute(route.PATCH);
export const DELETE = webRoute(route.DELETE);
