import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { dispatchRoute, type RouteContext } from "@sourcefold/client";
import {
  closedDesktopBridge,
  createServer,
  createWebApi,
  type ToolContext,
} from "@sourcefold/mcp/server";
import { authenticateMcpRequest } from "@/lib/mcp-auth";
import { webHost } from "@/lib/web-host";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Cache-Control": "no-store",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(body: unknown, status: number, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return withCors(new Response(JSON.stringify(body), { status, headers }));
}

function jsonRpcError(status: number, message: string, code: number): Response {
  return jsonResponse({ jsonrpc: "2.0", error: { code, message }, id: null }, status);
}

function unauthorized(request: Request, message: string): Response {
  const metadataUrl = new URL(
    "/.well-known/oauth-protected-resource/api/mcp",
    new URL(request.url).origin,
  ).toString();
  return jsonResponse({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }, 401, {
    "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}"`,
  });
}

function methodNotAllowed(): Response {
  return jsonResponse({ error: { message: "Method not allowed." } }, 405, {
    Allow: "POST, OPTIONS",
  });
}

function pathAndQuery(input: RequestInfo | URL): string {
  const address = input instanceof Request ? input.url : input.toString();
  const url = new URL(address);
  return `${url.pathname}${url.search}`;
}

export async function OPTIONS(): Promise<Response> {
  return withCors(new Response(null, { status: 204 }));
}

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}

export async function POST(request: Request): Promise<Response> {
  let auth: Awaited<ReturnType<typeof authenticateMcpRequest>>;
  try {
    auth = await authenticateMcpRequest(request);
  } catch {
    return jsonRpcError(500, "Sourcefold couldn't verify this access token.", -32603);
  }
  if ("error" in auth) {
    if (auth.error.status === 401) return unauthorized(request, auth.error.message);
    const code = auth.error.status === 403 ? -32003 : -32603;
    return jsonRpcError(auth.error.status, auth.error.message, code);
  }

  const routeContext: RouteContext = {
    db: auth.db,
    userId: auth.userId,
    via: auth.via,
    host: webHost,
  };
  const toolContext: ToolContext = {
    api: createWebApi({
      credentials: () => ({
        webUrl: "https://sourcefold.invalid",
        token: "in-process-mcp",
        source: "settings",
        email: null,
      }),
      fetch: (input, init) => dispatchRoute(routeContext, pathAndQuery(input), init),
    }),
    desktop: closedDesktopBridge,
  };

  try {
    const server = createServer(toolContext, { mode: "remote", addedBy: auth.addedBy });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return withCors(await transport.handleRequest(request));
  } catch {
    return jsonRpcError(500, "Sourcefold couldn't handle this MCP request.", -32603);
  }
}
