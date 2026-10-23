import * as route from "@sourcefold/client/routes/grokipedia";
import { webRoute } from "@/lib/web-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = webRoute(route.POST);
