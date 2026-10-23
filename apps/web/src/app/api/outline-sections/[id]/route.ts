import * as route from "@sourcefold/client/routes/outline-sections/[id]";
import { webRoute } from "@/lib/web-route";

export const dynamic = "force-dynamic";

export const PUT = webRoute(route.PUT);
export const DELETE = webRoute(route.DELETE);
