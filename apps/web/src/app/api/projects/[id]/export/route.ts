import * as route from "@sourcefold/client/routes/projects/[id]/export";
import { webRoute } from "@/lib/web-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = webRoute(route.GET);
