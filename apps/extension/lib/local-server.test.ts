import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { browser } from "wxt/browser";
import { EXTENSION_ID_HEADER, localServerFetch, localServerHeaders } from "./local-server";
import { apiFetchDesktopHttp } from "./api";
import { invalidateTargetCache, resolveTarget } from "./target";

const AUTO_SETTINGS = { connectionMode: "auto" } as const;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Local server identity header", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    invalidateTargetCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    invalidateTargetCache();
  });

  it("adds the extension's own runtime id to local-server headers", () => {
    const headers = localServerHeaders({ Accept: "application/json" });
    expect(headers.get(EXTENSION_ID_HEADER)).toBe(browser.runtime.id);
    expect(headers.get("Accept")).toBe("application/json");
  });

  it("sends the header on every local-server request", async () => {
    const seen: { url: string; id: string | null }[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      seen.push({ url: String(url), id: new Headers(init?.headers).get(EXTENSION_ID_HEADER) });
      return jsonResponse([]);
    });

    await localServerFetch("/api/native-host/status");
    await apiFetchDesktopHttp("/api/folders");
    await apiFetchDesktopHttp("/api/folders", { method: "POST", body: "{}" });

    expect(seen).toHaveLength(3);
    for (const call of seen) {
      expect(call.url.startsWith("http://127.0.0.1:23456/")).toBe(true);
      expect(call.id).toBe(browser.runtime.id);
    }
  });

  it("sends the header when reading the session and health over local HTTP", async () => {
    const seen: { path: string; id: string | null }[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      seen.push({
        path: new URL(String(url)).pathname,
        id: new Headers(init?.headers).get(EXTENSION_ID_HEADER),
      });
      return new Response("Forbidden", { status: 403 });
    });

    // Native messaging fails in the mock; HTTP answers 403 for both session and health.
    const target = await resolveTarget({ forceRefresh: true, settings: { ...AUTO_SETTINGS } });

    expect(target.type).toBe("signed-out");
    expect(seen.map((s) => s.path)).toEqual(["/api/session", "/api/health"]);
    for (const call of seen) {
      expect(call.id).toBe(browser.runtime.id);
    }
  });

  it("resolves desktop-offline only when local HTTP answers signedIn: false", async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementation(async () => jsonResponse({ data: { signedIn: false } }));

    const target = await resolveTarget({ forceRefresh: true, settings: { ...AUTO_SETTINGS } });

    expect(target).toMatchObject({ type: "desktop-offline", transport: "http" });
  });

  it("resolves an error, not offline, when the session is forbidden but the desktop answers health", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (String(url).endsWith("/api/session")) {
        return jsonResponse({ error: { message: "Forbidden" } }, 403);
      }
      return jsonResponse({ status: "ok" });
    });

    const target = await resolveTarget({ forceRefresh: true, settings: { ...AUTO_SETTINGS } });

    expect(target.type).toBe("error");
    expect(target.displayLabel).toBe(
      "This desktop app is too old to share its sign-in. Update it, or sign in with Google here.",
    );
  });
});
