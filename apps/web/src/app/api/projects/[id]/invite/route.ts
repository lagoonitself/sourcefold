import * as route from "@sourcefold/client/routes/projects/[id]/invite";
import { webRoute } from "@/lib/web-route";

export const dynamic = "force-dynamic";

export const POST = webRoute(route.POST);
export const DELETE = webRoute(route.DELETE);
