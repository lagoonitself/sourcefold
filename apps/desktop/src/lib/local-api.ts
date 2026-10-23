import { createLocalApi, type LocalApiWithDrive } from "@sourcefold/client";
import { getSupabase } from "./supabase";
import { desktopFetchUrl } from "./web-fetch";

// Signed in, the website's API runs here, in the webview (`createLocalApi` from
// `@sourcefold/client`): same paths and answers as the website, talking to Supabase and Google
// Drive directly (docs/dev/handoff-no-website.md). Rust reaches it through `local-api-request`
// events (src-tauri/src/local_api.rs), for the local copy.

const parseHtml = (html: string) => new DOMParser().parseFromString(html, "text/html");

let api: LocalApiWithDrive | null = null;
let apiFor: ReturnType<typeof getSupabase> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** After changes (including ones Rust or Claude asked for), the views reload once. */
function itemsChanged(): void {
  if (typeof window === "undefined") return;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    window.dispatchEvent(new Event("sourcefold:refresh"));
  }, 1500);
}

export function getLocalApi(): LocalApiWithDrive {
  const supabase = getSupabase();
  if (!api || apiFor !== supabase) {
    api?.dispose();
    api = createLocalApi({
      supabase,
      fetchUrl: desktopFetchUrl,
      parseHtml,
      onItemsChanged: itemsChanged,
    });
    apiFor = supabase;
  }
  return api;
}

/** Drops the local API (sign-out); a pending Drive push is pushed first when asked. */
export async function closeLocalApi(options: { flush?: boolean } = {}): Promise<void> {
  if (!api) return;
  const current = api;
  api = null;
  apiFor = null;
  if (options.flush) {
    try {
      await current.flushDrivePush();
    } catch (err) {
      console.warn("Drive push before sign-out failed", err);
    }
  }
  current.dispose();
}

interface BridgeRequest {
  id: number;
  method: string;
  path: string;
  body?: string | null;
}

async function answer(
  request: BridgeRequest,
): Promise<{ status: number; type: string; bytes: Uint8Array }> {
  try {
    const res = await getLocalApi().fetch(request.path, {
      method: request.method,
      body: request.body ?? undefined,
      headers: request.body ? { "Content-Type": "application/json" } : undefined,
    });
    return {
      status: res.status,
      type: res.headers.get("content-type") ?? "",
      bytes: new Uint8Array(await res.arrayBuffer()),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong. Try again.";
    return {
      status: 500,
      type: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify({ error: { message } })),
    };
  }
}

let bridgeStarted: Promise<void> | null = null;

/** Answers Rust's `local-api-request` events. Safe to call more than once. */
export function startLocalApiBridge(): Promise<void> {
  if (bridgeStarted) return bridgeStarted;
  bridgeStarted = (async () => {
    const [{ listen }, { invoke }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/core"),
    ]);
    await listen<BridgeRequest>("local-api-request", (event) => {
      void answer(event.payload).then(({ status, type, bytes }) =>
        // Raw bytes as the body; the rest in headers (src-tauri/src/local_api.rs).
        invoke("local_api_respond", bytes, {
          headers: {
            "x-local-api-id": String(event.payload.id),
            "x-local-api-status": String(status),
            "x-local-api-content-type": type,
          },
        }).catch((err) => console.error("Couldn't answer a local API request", err)),
      );
    });
  })().catch((err) => {
    bridgeStarted = null;
    console.error("Couldn't start the local API bridge", err);
  });
  return bridgeStarted;
}
