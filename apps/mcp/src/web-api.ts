import { loadCredentials, NOT_SIGNED_IN_MESSAGE, type Credentials } from "./config";

// The web app's API, as the signed-in user. Every route answers `{ data }` or
// `{ error: { message, code? } }`; this unwraps the first and throws the second as an
// `ApiError` whose message is the web app's own (it is written for people, so tools pass it on).

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export class NotSignedInError extends Error {
  constructor() {
    super(NOT_SIGNED_IN_MESSAGE);
    this.name = "NotSignedInError";
  }
}

const EXPIRED_MESSAGE = {
  desktop:
    "The desktop app's sign-in is no longer valid. Open the Sourcefold desktop app and sign in again.",
  settings:
    "The access token in Claude Desktop isn't valid any more. Create a new one on the website (Settings → Access tokens) and paste it in Claude Desktop → Settings → Extensions → Sourcefold.",
} as const;

export interface RequestOptions {
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  /** Default 60 s, the web app's own limit per request. */
  timeoutMs?: number;
}

export interface WebApi {
  /** The sign-in in use, or null. Never throws. */
  credentials(): Credentials | null;
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  delete<T>(path: string, options?: RequestOptions): Promise<T>;
  /** For routes that answer with plain text (`GET /api/items/[id]/content`). */
  text(path: string, options?: RequestOptions): Promise<string>;
}

export interface WebApiDeps {
  credentials?: () => Credentials | null;
  fetch?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function createWebApi(deps: WebApiDeps = {}): WebApi {
  const getCredentials = deps.credentials ?? (() => loadCredentials());
  const fetchImpl = deps.fetch ?? fetch;

  async function send(method: string, path: string, options: RequestOptions = {}) {
    const creds = getCredentials();
    if (!creds) throw new NotSignedInError();

    const url = new URL(`${creds.webUrl}/api${path.startsWith("/") ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { Authorization: `Bearer ${creds.token}` };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    let res: Response;
    try {
      res = await fetchImpl(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      const reason =
        err instanceof Error && err.name === "TimeoutError"
          ? "it took too long to answer"
          : "it couldn't be reached";
      throw new ApiError(0, `Sourcefold (${creds.webUrl}) didn't answer: ${reason}.`);
    }

    if (res.status === 401) throw new ApiError(401, EXPIRED_MESSAGE[creds.source]);
    return res;
  }

  async function json<T>(method: string, path: string, options?: RequestOptions): Promise<T> {
    const res = await send(method, path, options);
    const payload = (await res.json().catch(() => null)) as {
      data?: T;
      error?: { message?: string; code?: string } | string;
    } | null;

    if (!res.ok) throw errorFrom(res.status, payload?.error);
    return (payload?.data ?? payload) as T;
  }

  return {
    credentials: () => {
      try {
        return getCredentials();
      } catch {
        return null;
      }
    },
    get: (path, options) => json("GET", path, options),
    post: (path, body, options) => json("POST", path, { ...options, body }),
    put: (path, body, options) => json("PUT", path, { ...options, body }),
    patch: (path, body, options) => json("PATCH", path, { ...options, body }),
    delete: (path, options) => json("DELETE", path, options),
    text: async (path, options) => {
      const res = await send("GET", path, options);
      if (res.ok) return await res.text();
      const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
      throw errorFrom(res.status, payload?.error);
    },
  };
}

function errorFrom(status: number, error: unknown): ApiError {
  if (typeof error === "string" && error) return new ApiError(status, error);
  if (error && typeof error === "object") {
    const { message, code } = error as { message?: unknown; code?: unknown };
    if (typeof message === "string" && message) {
      return new ApiError(status, message, typeof code === "string" ? code : null);
    }
  }
  return new ApiError(status, `Sourcefold answered with an error (${status}).`);
}
