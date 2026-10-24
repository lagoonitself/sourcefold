import * as route from "@sourcefold/client/routes/tldrs/[itemId]";
import { webRoute } from "@/lib/web-route";

export const dynamic = "force-dynamic";

export const PUT = webRoute(route.PUT);
export const DELETE = webRoute(route.DELETE);
