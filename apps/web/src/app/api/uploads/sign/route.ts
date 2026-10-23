import * as route from "@sourcefold/client/routes/uploads/sign";
import { webRoute } from "@/lib/web-route";

export const dynamic = "force-dynamic";

export const POST = webRoute(route.POST);
