import { protectedResourceResponse } from "@/lib/mcp-discovery";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  return protectedResourceResponse(request);
}
