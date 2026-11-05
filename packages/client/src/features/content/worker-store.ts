// The content Worker's client (docs/dev/PLAN-teams.md, "Content Worker contract"). Runs in the
// desktop webview, the extension and on the website, so it uses only fetch and Uint8Array.
import type { ContentStore, StoredContent } from "../../host";

export class ContentStoreError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ContentStoreError";
  }
}

export interface WorkerContentStoreOptions {
  /** The Worker's address, e.g. `https://sourcefold-content.writey.workers.dev`. */
  baseUrl: string;
  /** The full `Authorization` header value (`Bearer …` or `Service …`), or null when signed out. */
  authorization(): Promise<string | null>;
  fetch?: typeof fetch;
}

async function failure(response: Response): Promise<ContentStoreError> {
  let code = "error";
  let message = `The content store answered ${response.status}.`;
  try {
    const body = (await response.json()) as { error?: { message?: unknown; code?: unknown } };
    if (typeof body.error?.message === "string") message = body.error.message;
    if (typeof body.error?.code === "string") code = body.error.code;
  } catch {
    // Not JSON; keep the generic message.
  }
  return new ContentStoreError(response.status, code, message);
}

export function createWorkerContentStore(options: WorkerContentStoreOptions): ContentStore {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const authorization = await options.authorization();
    if (!authorization) {
      throw new ContentStoreError(401, "unauthorized", "Sign in to continue.");
    }
    const headers = new Headers(init.headers);
    headers.set("Authorization", authorization);
    return doFetch(`${base}${path}`, { ...init, headers });
  }

  async function stored(response: Response): Promise<StoredContent> {
    if (!response.ok) throw await failure(response);
    const body = (await response.json()) as { data?: { sha256?: unknown; bytes?: unknown } };
    const sha256 = body.data?.sha256;
    const bytes = body.data?.bytes;
    if (typeof sha256 !== "string" || typeof bytes !== "number") {
      throw new ContentStoreError(502, "bad_response", "The content store sent an odd answer.");
    }
    return { sha256, bytes };
  }

  return {
    async getText(itemId) {
      const response = await request(`/v1/items/${encodeURIComponent(itemId)}/text`);
      if (response.status === 404) return null;
      if (!response.ok) throw await failure(response);
      return response.text();
    },
    async putText(itemId, body) {
      return stored(
        await request(`/v1/items/${encodeURIComponent(itemId)}/text`, {
          method: "PUT",
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
          body,
        }),
      );
    },
    async getFile(itemId) {
      const response = await request(`/v1/items/${encodeURIComponent(itemId)}/file`);
      if (response.status === 404) return null;
      if (!response.ok) throw await failure(response);
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        mimeType: response.headers.get("Content-Type") ?? "application/octet-stream",
      };
    },
    async putFile(itemId, bytes, mimeType) {
      return stored(
        await request(`/v1/items/${encodeURIComponent(itemId)}/file`, {
          method: "PUT",
          headers: { "Content-Type": mimeType },
          body: bytes as BodyInit,
        }),
      );
    },
  };
}
