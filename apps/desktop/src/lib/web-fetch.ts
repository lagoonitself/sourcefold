import { SourceError, type SourceFetch, type SourceFetchResponse } from "@sourcefold/core";

/**
 * `SourceFetch` for the desktop app, backed by the Rust `web_fetch` command. The extractors in
 * `@sourcefold/core` never call `fetch`; they receive this function. Rust does the request (no
 * CORS, the user's own connection) and its address checks keep this computer's local server out of
 * reach. The Rust request keeps running when the caller aborts.
 */

/** What the Rust `web_fetch` command returns. `bytes` is base64 and only set for `responseType: "bytes"`. */
interface WebFetchResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  text: string;
  bytes?: string | null;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function decodeBase64(value: string): Uint8Array {
  const atobImpl = (globalThis as { atob?: (data: string) => string }).atob;
  if (typeof atobImpl === "function") {
    const binary = atobImpl(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  const BufferImpl = (
    globalThis as { Buffer?: { from(data: string, encoding: string): Uint8Array } }
  ).Buffer;
  return BufferImpl ? new Uint8Array(BufferImpl.from(value, "base64")) : new Uint8Array();
}

function asMessage(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "message" in raw) {
    const message = (raw as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(raw ?? "");
}

/** Maps the Rust error string to the `SourceError` the extractors expect. */
function mapError(raw: unknown): SourceError {
  const message = asMessage(raw);
  if (message.startsWith("invalid_url")) {
    return new SourceError("invalid_url", "That link can't be opened.");
  }
  if (message.startsWith("blocked_address")) {
    return new SourceError(
      "blocked",
      "Sourcefold doesn't open links to this computer or your local network.",
    );
  }
  if (message.startsWith("too_large")) {
    return new SourceError("too_large", "This file is too large to save.");
  }
  return new SourceError(
    "fetch_failed",
    "Couldn't reach the site. Check your connection and try again.",
  );
}

export const desktopSourceFetch: SourceFetch = async (request) => {
  const { signal } = request;
  if (signal?.aborted) throw abortError();

  const responseType = request.responseType === "bytes" ? "bytes" : "text";
  const pending = tauriInvoke<WebFetchResponse>("web_fetch", {
    url: request.url,
    method: request.method === "POST" ? "POST" : "GET",
    headers: request.headers ?? {},
    body: request.body ?? null,
    responseType,
  });
  // If the caller aborts, `pending` still settles later; make sure its rejection is handled.
  pending.catch(() => {});
  const mapped = pending.catch((error) => {
    throw mapError(error);
  });

  let response: WebFetchResponse;
  if (!signal) {
    response = await mapped;
  } else {
    let onAbort: (() => void) | null = null;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      response = await Promise.race([mapped, aborted]);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  const result: SourceFetchResponse = {
    status: response.status,
    url: response.url,
    headers: response.headers ?? {},
    text: response.text ?? "",
  };
  if (responseType === "bytes") {
    result.bytes = response.bytes ? decodeBase64(response.bytes) : new Uint8Array();
  }
  return result;
};
