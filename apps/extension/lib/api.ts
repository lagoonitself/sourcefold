import { browser } from "wxt/browser";
import type { CaptureRequest, XPostCapture } from "@sourcefold/core";
import { sendNativeMessage } from "./native-messaging";
import { invalidateTargetCache } from "./target";
import { accountFetch, resolveTarget } from "./account-channel";
import { DEFAULT_DESKTOP_HTTP, localServerFetch } from "./local-server";

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  position: number;
  item_count?: number;
}

export interface SavedItem {
  id: string;
  folder_id: string;
  kind: string;
  title: string;
  source_url?: string;
  canonical_url?: string;
  status: string;
}

export interface CheckUrlResult {
  exists: boolean;
  item_id?: string;
  title?: string;
  folder_id?: string;
  folder_name?: string;
}

export interface RecentXItem {
  id: string;
  title: string;
  canonical_url: string;
  saved_at: string;
  post_count: number;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  folderName?: string;

  constructor(message: string, status: number, code?: string, folderName?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.folderName = folderName;
  }
}

/**
 * Normalize a Sourcefold response envelope so callers can handle either:
 *  - Web app / wrapped responses:  { data: [...] } or { data: { ... } }
 *  - Desktop app / raw responses:   [...] or { ... }
 *  - Native messaging wrapped:       { data: [...] }
 *
 * Always returns the inner `data` payload when present, otherwise the raw value.
 */
export function unwrapResponse<T = any>(payload: any): T {
  if (Array.isArray(payload)) return payload as T;
  if (payload && typeof payload === "object") {
    if (Object.prototype.hasOwnProperty.call(payload, "data") && payload.data !== undefined) {
      return payload.data as T;
    }
  }
  return payload as T;
}

/** Reads a Sourcefold answer: the `{ data }` payload, or an `ApiError` with the server's message. */
export function readAnswer<T>(status: number, json: any, fallback: string): T {
  if (status === 0 || status >= 400) {
    const message = json?.error?.message || fallback;
    throw new ApiError(message, status, json?.error?.code, json?.error?.folder_name);
  }
  return unwrapResponse<T>(json);
}

/**
 * A request to the account (Supabase and Drive, no website), run by the local API in the
 * background worker. The popup never sees a token.
 */
export async function apiFetchAccount<T>(path: string, init?: RequestInit): Promise<T> {
  const body = typeof init?.body === "string" ? init.body : undefined;
  const res = await accountFetch({ path, method: init?.method ?? "GET", body });
  let json: any = null;
  try {
    json = res.body ? JSON.parse(res.body) : null;
  } catch {
    // Non-JSON response
  }
  if (res.status === 401) invalidateTargetCache();
  return readAnswer<T>(res.status, json, `Sourcefold returned ${res.status}.`);
}

/**
 * Make an HTTP request to the local desktop app offline server.
 * Never sends any auth token.
 */
export async function apiFetchDesktopHttp<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await localServerFetch(path, {
      ...init,
      headers,
    });
  } catch {
    invalidateTargetCache();
    throw new ApiError(
      `Couldn't reach Sourcefold desktop app at ${DEFAULT_DESKTOP_HTTP}. Check that the app is running.`,
      0,
    );
  }

  let json: any = null;
  try {
    json = await response.json();
  } catch {
    // Non-JSON response
  }

  if (!response.ok) {
    const message =
      json?.error?.message ||
      `Sourcefold desktop returned ${response.status}: ${response.statusText}`;
    const code = json?.error?.code;
    const folderName = json?.error?.folder_name;
    throw new ApiError(message, response.status, code, folderName);
  }

  return unwrapResponse<T>(json);
}

async function executeWithTarget<T>(
  nativePayload: any,
  httpPath: string,
  httpInit?: RequestInit,
): Promise<T> {
  const target = await resolveTarget();

  if (target.type === "signed-out" || target.type === "error") {
    throw new ApiError(target.displayLabel, 0);
  }

  // Signed in (the extension itself, or the desktop app's sign-in): the account
  if (target.type === "account") {
    return await apiFetchAccount<T>(httpPath, httpInit);
  }

  // Desktop reachable but not signed in: save to desktop offline library
  if (target.type === "desktop-offline") {
    if (target.transport === "native") {
      try {
        const nativeResult = await sendNativeMessage<any>(nativePayload);
        return unwrapResponse<T>(nativeResult);
      } catch (err) {
        // Try dynamic registration of extension ID if needed
        try {
          const extensionId = browser.runtime?.id;
          if (extensionId) {
            localServerFetch("/api/native-host/register", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ extension_id: extensionId }),
            }).catch(() => {});
          }
        } catch {
          // Non-blocking
        }

        // Native messaging failed: fallback to local HTTP (offline, no token)
        try {
          return await apiFetchDesktopHttp<T>(httpPath, httpInit);
        } catch (httpErr) {
          invalidateTargetCache();
          throw err instanceof ApiError ? err : httpErr;
        }
      }
    } else {
      // transport is http
      return await apiFetchDesktopHttp<T>(httpPath, httpInit);
    }
  }

  throw new ApiError("Unknown target", 0);
}

export async function listFolders(): Promise<Folder[]> {
  return executeWithTarget<Folder[]>({ type: "list_folders" }, "/api/folders");
}

export async function createFolder(params: {
  name: string;
  parent_id?: string | null;
}): Promise<Folder> {
  return executeWithTarget<Folder>(
    {
      type: "create_folder",
      name: params.name,
      parent_id: params.parent_id,
    },
    "/api/folders",
    {
      method: "POST",
      body: JSON.stringify(params),
    },
  );
}

/** Whether the link is already saved in this group (other groups can hold their own copy). */
export async function checkUrl(url: string, folder_id: string): Promise<CheckUrlResult> {
  return executeWithTarget<CheckUrlResult>(
    {
      type: "check_url",
      url,
      folder_id,
    },
    "/api/items/check",
    {
      method: "POST",
      body: JSON.stringify({ url, folder_id }),
    },
  );
}

export async function saveGrokipedia(url: string, folder_id: string): Promise<{ item: SavedItem }> {
  return executeWithTarget<{ item: SavedItem }>(
    {
      type: "save_grokipedia",
      url,
      folder_id,
    },
    "/api/grokipedia",
    {
      method: "POST",
      body: JSON.stringify({ url, folder_id }),
    },
  );
}

export async function capture(
  body: CaptureRequest,
): Promise<{ item: SavedItem; unavailable?: boolean }> {
  return executeWithTarget<{ item: SavedItem; unavailable?: boolean }>(
    {
      type: "capture",
      ...body,
    },
    "/api/capture",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

/** Recent X threads in the project that holds this group. */
export async function recentXItems(folderId: string): Promise<RecentXItem[]> {
  return executeWithTarget<RecentXItem[]>(
    {
      type: "recent_x_items",
      folder_id: folderId,
    },
    `/api/x/recent?folder=${encodeURIComponent(folderId)}`,
  );
}

export async function addXPost(
  itemId: string,
  params: { post: XPostCapture; parent_post_url?: string },
): Promise<{ item_id: string; post_id: string }> {
  return executeWithTarget<{ item_id: string; post_id: string }>(
    {
      type: "add_x_post",
      item_id: itemId,
      post: params.post,
      parent_post_url: params.parent_post_url,
    },
    `/api/x/${itemId}/posts`,
    {
      method: "POST",
      body: JSON.stringify(params),
    },
  );
}
