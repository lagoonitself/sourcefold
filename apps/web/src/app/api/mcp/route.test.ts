import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  authenticateMcpRequest: vi.fn(),
  dispatchRoute: vi.fn(),
  createServer: vi.fn(),
}));

vi.mock("@/lib/mcp-auth", () => ({
  authenticateMcpRequest: mocks.authenticateMcpRequest,
}));
vi.mock("@/lib/web-host", () => ({ webHost: {} }));
vi.mock("@sourcefold/client", () => ({ dispatchRoute: mocks.dispatchRoute }));
vi.mock("@sourcefold/mcp/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sourcefold/mcp/server")>();
  return { ...actual, createServer: mocks.createServer };
});

import { DELETE, GET, OPTIONS, POST } from "./route";

function mcpRequest(body: unknown, token = "sf_test") {
  return new Request("https://sourcefold.example/api/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify(body),
  });
}

function newTestServer(ctx: { api: { get<T>(path: string): Promise<T> } }) {
  const server = new McpServer({ name: "Sourcefold test", version: "1.0.0" });
  server.registerTool(
    "probe",
    {
      title: "Probe",
      description: "Read the test route through the shared web API.",
      inputSchema: { label: z.string() },
    },
    async ({ label }) => {
      const health = await ctx.api.get<{ status: string }>("/health");
      return { content: [{ type: "text", text: `${label}:${health.status}` }] };
    },
  );
  return server;
}

describe("stateless MCP HTTP route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateMcpRequest.mockResolvedValue({
      db: {},
      userId: "user-1",
      via: "token",
      addedBy: "Claude",
    });
    mocks.dispatchRoute.mockResolvedValue(Response.json({ data: { status: "ready" } }));
    mocks.createServer.mockImplementation((ctx: Parameters<typeof newTestServer>[0]) =>
      newTestServer(ctx),
    );
  });

  it("runs initialize, tools/list, and tools/call without a session id", async () => {
    const initialized = await POST(
      mcpRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    );
    expect(initialized.status).toBe(200);
    expect(initialized.headers.get("Mcp-Session-Id")).toBeNull();
    expect((await initialized.json()).result.protocolVersion).toBe("2025-06-18");

    const listed = await POST(
      mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    );
    expect(listed.status).toBe(200);
    expect((await listed.json()).result.tools.map((tool: { name: string }) => tool.name)).toContain(
      "probe",
    );

    const called = await POST(
      mcpRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "probe", arguments: { label: "route" } },
      }),
    );
    expect(called.status).toBe(200);
    expect((await called.json()).result.content[0].text).toBe("route:ready");
    expect(mocks.createServer).toHaveBeenCalledTimes(3);
    expect(mocks.createServer).toHaveBeenCalledWith(expect.any(Object), {
      mode: "remote",
      addedBy: "Claude",
    });
    expect(mocks.dispatchRoute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", via: "token" }),
      "/api/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns the protected-resource challenge on missing auth", async () => {
    mocks.authenticateMcpRequest.mockResolvedValue({
      error: { status: 401, message: "A Bearer access token is required." },
    });

    const response = await POST(
      mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, ""),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="https://sourcefold.example/.well-known/oauth-protected-resource/api/mcp"',
    );
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      error: { message: "A Bearer access token is required." },
    });
  });

  it("returns the same protected-resource challenge for an invalid token", async () => {
    mocks.authenticateMcpRequest.mockResolvedValue({
      error: { status: 401, message: "This access token isn't valid." },
    });

    const response = await POST(
      mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="https://sourcefold.example/.well-known/oauth-protected-resource/api/mcp"',
    );
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      error: { message: "This access token isn't valid." },
    });
  });

  it("answers CORS preflight without auth", async () => {
    const response = await OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("WWW-Authenticate");
    expect(mocks.authenticateMcpRequest).not.toHaveBeenCalled();
  });

  it("answers GET and DELETE with 405", async () => {
    expect((await GET()).status).toBe(405);
    expect((await DELETE()).status).toBe(405);
  });
});
