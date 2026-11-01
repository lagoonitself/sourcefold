import { getPublicEnv } from "@/lib/env";

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: ["header"];
  resource_name: "Sourcefold";
}

export function protectedResourceMetadata(
  origin: string,
  supabaseUrl: string,
): ProtectedResourceMetadata {
  const baseUrl = supabaseUrl.replace(/\/+$/, "");
  return {
    resource: `${origin.replace(/\/+$/, "")}/api/mcp`,
    authorization_servers: [`${baseUrl}/auth/v1`],
    bearer_methods_supported: ["header"],
    resource_name: "Sourcefold",
  };
}

export function protectedResourceResponse(request: Request): Response {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
  return Response.json(
    protectedResourceMetadata(new URL(request.url).origin, NEXT_PUBLIC_SUPABASE_URL),
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}

export async function getOAuthAuthorizationServerMetadata(fetcher: typeof fetch = fetch) {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
  const baseUrl = NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
  const metadataUrl = `${baseUrl}/.well-known/oauth-authorization-server/auth/v1`;
  const response = await fetcher(metadataUrl, {
    next: { revalidate: 300 },
  } as RequestInit);

  if (!response.ok) {
    throw new Error(`Supabase OAuth discovery answered ${response.status}.`);
  }

  const metadata = (await response.json()) as unknown;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Supabase OAuth discovery returned invalid metadata.");
  }

  return metadata as Record<string, unknown>;
}
