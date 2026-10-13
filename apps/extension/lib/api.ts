import type { CaptureRequest, XPostCapture } from "@sourcefold/core";
import { getSettings } from "./settings";

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  position: number;
  item_count?: number;
}

export interface CheckUrlResultExists {
  exists: true;
  item_id: string;
  folder_id: string;
  folder_name: string;
}

export interface CheckUrlResultNotExists {
  exists: false;
}

export type CheckUrlResult = CheckUrlResultExists | CheckUrlResultNotExists;

export interface RecentXItem {
  id: string;
  title: string;
  folder_id: string;
  created_at: string;
}

export interface SavedItem {
  id: string;
  folder_id: string;
  kind: string;
  title: string;
  source_url: string | null;
  status: string;
  created_at: string;
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

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const settings = await getSettings();
  const baseUrl = settings.appUrl.replace(/\/+$/, "");

  try {
    const parsed = new URL(baseUrl);
    const isLoopback =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]";
    if (parsed.protocol !== "https:" && !isLoopback) {
      throw new ApiError("Remote Sourcefold addresses must use HTTPS.", 0);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
  }

  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const headers = new Headers(init?.headers);
  if (settings.token && settings.token.trim().length > 0) {
    headers.set("Authorization", `Bearer ${settings.token.trim()}`);
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch {
    throw new ApiError(
      `Couldn't reach Sourcefold at ${settings.appUrl}. Check the address in settings.`,
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
    throw new ApiError(
      "Your access token isn't valid. Create a new one in Sourcefold's Settings.",
      401,
      json?.error?.code,
      json?.error?.folder_name,
    );
  }

  if (!response.ok || (json && typeof json === "object" && "error" in json)) {
    const errorPayload = json?.error;
    const message =
      typeof errorPayload?.message === "string"
        ? errorPayload.message
        : response.statusText || `Request failed with status ${response.status}`;
    const code = typeof errorPayload?.code === "string" ? errorPayload.code : undefined;
    const folderName =
      typeof errorPayload?.folder_name === "string" ? errorPayload.folder_name : undefined;

    throw new ApiError(message, response.status, code, folderName);
  }

  if (json && typeof json === "object" && "data" in json) {
    return json.data as T;
  }

  return json as T;
}

export async function listFolders(): Promise<Folder[]> {
  return apiFetch<Folder[]>("/api/folders");
}

export async function createFolder(params: {
  name: string;
  parent_id?: string | null;
}): Promise<Folder> {
  return apiFetch<Folder>("/api/folders", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function checkUrl(url: string): Promise<CheckUrlResult> {
  return apiFetch<CheckUrlResult>("/api/items/check", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export async function saveGrokipedia(url: string, folder_id: string): Promise<{ item: SavedItem }> {
  return apiFetch<{ item: SavedItem }>("/api/grokipedia", {
    method: "POST",
    body: JSON.stringify({ url, folder_id }),
  });
}

export async function capture(
  body: CaptureRequest,
): Promise<{ item: SavedItem; unavailable?: boolean }> {
  return apiFetch<{ item: SavedItem; unavailable?: boolean }>("/api/capture", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function recentXItems(): Promise<RecentXItem[]> {
  return apiFetch<RecentXItem[]>("/api/x/recent");
}

export async function addXPost(
  itemId: string,
  params: { post: XPostCapture; parent_post_url?: string },
): Promise<{ item_id: string; post_id: string }> {
  return apiFetch<{ item_id: string; post_id: string }>(`/api/x/${itemId}/posts`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}
