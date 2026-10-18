import { join } from "node:path";
import { appDataDir, readJsonFile } from "./config";
import type {
  DesktopSearchRequest,
  DesktopStatus,
  SearchResponse,
  ShowTarget,
  SubstackFetchResult,
} from "./types";

// The desktop app's `/api/agent/*` routes on its loopback server (docs/dev/handoff-mcp.md,
// "Desktop bridge"). The app writes a new key to `agent.json` on every start; it is read on every
// call, so a restarted app is picked up at once.

export const DESKTOP_CLOSED_MESSAGE = "Open the Sourcefold desktop app first.";

export class DesktopClosedError extends Error {
  constructor() {
    super(DESKTOP_CLOSED_MESSAGE);
    this.name = "DesktopClosedError";
  }
}

export interface DesktopBridge {
  /** Null when the desktop app isn't running (or is too old to have the agent routes). */
  status(): Promise<DesktopStatus | null>;
  search(request: DesktopSearchRequest): Promise<SearchResponse>;
  show(target: ShowTarget): Promise<void>;
  /** Tells the app the library changed so it reloads now. Never throws. */
  changed(): Promise<void>;
  substackFetch(url: string, withCookie: boolean): Promise<SubstackFetchResult>;
}

interface AgentFile {
  port?: number;
  key?: string;
}

export interface DesktopBridgeDeps {
  agentFile?: () => AgentFile | null;
  fetch?: typeof fetch;
}

export function createDesktopBridge(deps: DesktopBridgeDeps = {}): DesktopBridge {
  const agentFile =
    deps.agentFile ?? (() => readJsonFile<AgentFile>(join(appDataDir(), "agent.json")));
  const fetchImpl = deps.fetch ?? fetch;

  async function call<T>(method: "GET" | "POST", route: string, body: unknown, timeoutMs: number) {
    const file = agentFile();
    if (!file?.key || !file.port) throw new DesktopClosedError();

    let res: Response;
    try {
      res = await fetchImpl(`http://127.0.0.1:${file.port}/api/agent/${route}`, {
        method,
        headers: {
          Authorization: `Bearer ${file.key}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new DesktopClosedError();
    }

    const payload = (await res.json().catch(() => null)) as
      (T & { error?: { message?: string } }) | null;
    // An app from before the agent routes answers 404 (or 403 for an unknown key).
    if (res.status === 404 || res.status === 403) throw new DesktopClosedError();
    if (!res.ok) {
      throw new Error(payload?.error?.message || `The desktop app answered ${res.status}.`);
    }
    return payload as T;
  }

  return {
    status: async () => {
      try {
        return await call<DesktopStatus>("GET", "status", undefined, 1_500);
      } catch {
        return null;
      }
    },
    search: (request) => call<SearchResponse>("POST", "search", request, 20_000),
    show: async (target) => {
      await call("POST", "show", target, 5_000);
    },
    changed: async () => {
      try {
        await call("POST", "changed", {}, 1_500);
      } catch {
        // The app reloads by itself on focus and every 30 s.
      }
    },
    substackFetch: (url, withCookie) =>
      call<SubstackFetchResult>("POST", "substack-fetch", { url, with_cookie: withCookie }, 30_000),
  };
}
