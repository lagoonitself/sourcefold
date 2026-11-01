import { getOAuthAuthorizationServerMetadata } from "@/lib/mcp-discovery";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const metadata = await getOAuthAuthorizationServerMetadata();
    return Response.json(metadata, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return Response.json(
      { error: { message: "Supabase OAuth discovery is unavailable." } },
      { status: 503, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } },
    );
  }
}
