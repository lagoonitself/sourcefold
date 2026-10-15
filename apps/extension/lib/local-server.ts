import { browser } from "wxt/browser";

export const DEFAULT_DESKTOP_HTTP = "http://127.0.0.1:23456";
export const EXTENSION_ID_HEADER = "X-Sourcefold-Extension";

/** Request headers every call to the desktop app's local server must carry. */
export function localServerHeaders(base?: HeadersInit): Headers {
  const headers = new Headers(base);
  const extensionId = browser.runtime?.id;
  if (extensionId) {
    headers.set(EXTENSION_ID_HEADER, extensionId);
  }
  return headers;
}

/** `fetch` against the desktop app's local server, identifying this extension. */
export function localServerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${DEFAULT_DESKTOP_HTTP}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, { ...init, headers: localServerHeaders(init.headers) });
}
