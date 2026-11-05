import * as route from "@sourcefold/client/routes/projects/[id]/members/[userId]";
import { webRoute } from "@/lib/web-route";

export const dynamic = "force-dynamic";

export const PATCH = webRoute(route.PATCH);
export const DELETE = webRoute(route.DELETE);
