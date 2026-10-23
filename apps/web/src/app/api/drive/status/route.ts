import * as route from "@sourcefold/client/routes/drive/status";
import { webRoute } from "@/lib/web-route";

export const dynamic = "force-dynamic";

export const GET = webRoute(route.GET);
