import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { vi } from "vitest";
import type { Credentials } from "../config";
import { createDesktopBridge, type DesktopBridge } from "../desktop-bridge";
import type { ToolContext } from "../tools/define";
import { createWebApi } from "../web-api";

// Test harness for tool modules: a fake web app (route table), a fake or missing desktop app, and
// a real MCP client connected in memory, so tests call tools exactly as Claude does.

export type Route = (req: {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}) =>
  | { status?: number; json?: unknown; text?: string }
  | Promise<{ status?: number; json?: unknown; text?: string }>;

export interface FakeWeb {
  /** Calls made, in order, as `GET /items?folder=…` (the `/api` prefix dropped). */
  calls: string[];
  bodies: unknown[];
  fetch: typeof fetch;
}

export const TEST_CREDENTIALS: Credentials = {
  webUrl: "https://sourcefold.test",
  token: "test-token",
  source: "desktop",
  email: "owner@example.com",
};

/** Routes are keyed `METHOD /path` (without `/api`); a `*` segment matches any id. */
export function fakeWeb(routes: Record<string, Route>): FakeWeb {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const match = (method: string, path: string): Route | undefined => {
    for (const [key, route] of Object.entries(routes)) {
      const [m, pattern] = key.split(" ");
      if (m !== method || !pattern) continue;
      const a = pattern.split("/");
      const b = path.split("/");
      if (a.length === b.length && a.every((seg, i) => seg === "*" || seg === b[i])) return route;
    }
    return undefined;
  };

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api/, "");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push(`${method} ${path}${url.search}`);
    bodies.push(body);
    const route = match(method, path);
    if (!route) {
      return new Response(JSON.stringify({ error: { message: `No fake for ${method} ${path}` } }), {
        status: 404,
      });
    }
    const out = await route({ method, path, query: url.searchParams, body });
    if (out.text !== undefined) return new Response(out.text, { status: out.status ?? 200 });
    return new Response(JSON.stringify(out.json ?? null), {
      status: out.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return { calls, bodies, fetch: fetchImpl };
}

/** A desktop app that is closed: every bridge call fails as if nothing listens. */
export function closedDesktop(): DesktopBridge {
  return createDesktopBridge({ agentFile: () => null });
}

/** A desktop app with the given parts faked; `changed` is a spy. */
export function fakeDesktop(parts: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    status: vi.fn(async () => ({
      version: "0.4.1",
      mode: "signed_in" as const,
      web_url: TEST_CREDENTIALS.webUrl,
      email: TEST_CREDENTIALS.email,
    })),
    search: vi.fn(async () => ({ passages: [], notes: [], meaning: "off" as const, took_ms: 1 })),
    show: vi.fn(async () => {}),
    changed: vi.fn(async () => {}),
    substackFetch: vi.fn(async () => {
      throw new Error("not faked");
    }),
    ...parts,
  };
}

export interface Harness {
  call(name: string, args?: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  listTools(): Promise<string[]>;
  ctx: ToolContext;
}

export async function connect(
  register: (server: McpServer, ctx: ToolContext) => void,
  options: { web: FakeWeb; desktop?: DesktopBridge; credentials?: Credentials | null },
): Promise<Harness> {
  const ctx: ToolContext = {
    api: createWebApi({
      credentials: () =>
        options.credentials === undefined ? TEST_CREDENTIALS : options.credentials,
      fetch: options.web.fetch,
    }),
    desktop: options.desktop ?? closedDesktop(),
  };
  const server = new McpServer({ name: "sourcefold-test", version: "0.0.0" });
  register(server, ctx);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  return {
    ctx,
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
      return {
        text: content.map((c) => c.text ?? "").join("\n"),
        isError: Boolean(result.isError),
      };
    },
    async listTools() {
      const { tools } = await client.listTools();
      return tools.map((t) => t.name);
    },
  };
}
