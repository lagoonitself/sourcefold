import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getRootMetadata } from "./route";
import { GET as getMcpMetadata } from "./api/mcp/route";
import { GET as getAuthorizationServerMetadata } from "../oauth-authorization-server/route";

vi.mock("@/lib/env", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co/" }),
}));

describe("MCP OAuth discovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["resource metadata at the origin", getRootMetadata],
    ["resource metadata at the MCP path", getMcpMetadata],
  ])("publishes %s", async (_label, handler) => {
    const response = handler(new Request("https://preview.example/.well-known/metadata"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: "https://preview.example/api/mcp",
      authorization_servers: ["https://project.supabase.co/auth/v1"],
      bearer_methods_supported: ["header"],
      resource_name: "Sourcefold",
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("forwards Supabase authorization-server metadata from its documented discovery URL", async () => {
    const metadata = {
      issuer: "https://project.supabase.co/auth/v1",
      authorization_endpoint: "https://project.supabase.co/auth/v1/oauth/authorize",
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(metadata));
    vi.stubGlobal("fetch", fetchMock);

    const response = await getAuthorizationServerMetadata();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(metadata);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://project.supabase.co/.well-known/oauth-authorization-server/auth/v1",
      { next: { revalidate: 300 } },
    );
  });

  it("returns 503 if Supabase metadata cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 502 })));

    const response = await getAuthorizationServerMetadata();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { message: "Supabase OAuth discovery is unavailable." },
    });
  });
});
