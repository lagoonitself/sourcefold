import * as route from "@sourcefold/client/routes/items/[id]/media/[name]";
import { webRoute } from "@/lib/web-route";

export const dynamic = "force-dynamic";

export const GET = webRoute(route.GET);
