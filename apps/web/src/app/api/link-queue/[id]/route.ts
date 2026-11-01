import * as route from "@sourcefold/client/routes/link-queue/[id]";
import { webRoute } from "@/lib/web-route";

export const dynamic = "force-dynamic";

export const PATCH = webRoute(route.PATCH);
export const DELETE = webRoute(route.DELETE);
