import * as route from "@sourcefold/client/routes/shelf";
import { webRoute } from "@/lib/web-route";

export const dynamic = "force-dynamic";

export const GET = webRoute(route.GET);
export const POST = webRoute(route.POST);
