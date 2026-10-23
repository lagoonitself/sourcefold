import * as route from "@sourcefold/client/routes/items/check";
import { webRoute } from "@/lib/web-route";

export const dynamic = "force-dynamic";

export const POST = webRoute(route.POST);
