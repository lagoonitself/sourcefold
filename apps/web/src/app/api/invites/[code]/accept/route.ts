import * as route from "@sourcefold/client/routes/invites/[code]/accept";
import { webRoute } from "@/lib/web-route";

export const dynamic = "force-dynamic";

export const POST = webRoute(route.POST);
