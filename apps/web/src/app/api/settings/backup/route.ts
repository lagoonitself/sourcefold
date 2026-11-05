import * as route from "@sourcefold/client/routes/settings/backup";
import { webRoute } from "@/lib/web-route";

export const dynamic = "force-dynamic";

export const GET = webRoute(route.GET);
export const PUT = webRoute(route.PUT);
