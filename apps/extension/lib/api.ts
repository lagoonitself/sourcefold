import { browser } from "wxt/browser";
import type { CaptureRequest, XPostCapture } from "@sourcefold/core";
import { isLocalUrl, getSettings } from "./settings";
import { sendNativeMessage } from "./native-messaging";
import { resolveTarget, invalidateTargetCache } from "./target";
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

/**
 * Make an HTTP request to a web API target.
 * Never sends the token anywhere except to the target web URL.
 */
export async function apiFetchWeb<T>(
  baseUrl: string,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const isLoopback = isLocalUrl(cleanBase);

  try {
    const parsed = new URL(cleanBase);
    if (parsed.protocol !== "https:" && !isLoopback) {
      throw new ApiError("Remote Sourcefold addresses must use HTTPS.", 0);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
  }

  const url = `${cleanBase}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Token is only sent to the resolved web target
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch {
    // Re-resolve on any network failure
    invalidateTargetCache();
    throw new ApiError(
      `Couldn't reach Sourcefold at ${cleanBase}. Check the address in settings.`,
      0,
    );
  }

  let json: any = null;
  try {
    json = await response.json();
  } catch {
    // Non-JSON response
  }

  if (response.status === 401) {
    // Re-resolve on 401 failure
    invalidateTargetCache();
    const message =
      json?.error?.message ||
      "Your access token isn't valid. Create a new one in Sourcefold's Settings.";
    throw new ApiError(message, 401, json?.error?.code);
  }

  if (!response.ok) {
    const message =
      json?.error?.message || `Sourcefold returned ${response.status}: ${response.statusText}`;
    const code = json?.error?.code;
    const folderName = json?.error?.folder_name;
    throw new ApiError(message, response.status, code, folderName);
  }

  return unwrapResponse<T>(json);
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

/**
 * Fallback / direct apiFetch supporting baseUrlOverride or resolving current settings.
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  baseUrlOverride?: string,
): Promise<T> {
  if (baseUrlOverride) {
    const settings = await getSettings();
    return apiFetchWeb<T>(baseUrlOverride, settings.token, path, init);
  }
  const target = await resolveTarget();
  if (target.type === "desktop-web" || target.type === "web") {
    return apiFetchWeb<T>(target.webUrl, target.token, path, init);
  }
  if (target.type === "desktop-offline") {
    return apiFetchDesktopHttp<T>(path, init);
  }
  throw new ApiError(target.displayLabel, 0);
}

async function executeWithTarget<T>(
  nativePayload: any,
  httpPath: string,
  httpInit?: RequestInit,
): Promise<T> {
  const target = await resolveTarget();

  if (target.type === "unconfigured") {
    throw new ApiError(target.displayLabel, 0);
  }

  // Desktop signed in OR configured web app: save to web API
  if (target.type === "desktop-web" || target.type === "web") {
    return await apiFetchWeb<T>(target.webUrl, target.token, httpPath, httpInit);
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
