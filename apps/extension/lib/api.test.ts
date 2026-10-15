import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { unwrapResponse, listFolders, ApiError, apiFetchWeb, apiFetchDesktopHttp } from "./api";
import {
  setCachedTarget,
  invalidateTargetCache,
  getCachedTarget,
  type ResolvedTarget,
} from "./target";

describe("Response Unwrapper", () => {
  it("unwraps { data: [...] }", () => {
    const raw = { data: [{ id: "f1", name: "Folder 1" }] };
    expect(unwrapResponse(raw)).toEqual([{ id: "f1", name: "Folder 1" }]);
  });

  it("unwraps bare arrays", () => {
    const raw = [{ id: "f1", name: "Folder 1" }];
    expect(unwrapResponse(raw)).toEqual([{ id: "f1", name: "Folder 1" }]);
  });

  it("unwraps { data: { ... } }", () => {
    const raw = { data: { id: "item1", title: "Article" } };
    expect(unwrapResponse(raw)).toEqual({ id: "item1", title: "Article" });
  });

  it("unwraps bare objects", () => {
    const raw = { id: "item1", title: "Article" };
    expect(unwrapResponse(raw)).toEqual({ id: "item1", title: "Article" });
  });
});

describe("Token Security and Routing", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    invalidateTargetCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    invalidateTargetCache();
  });

  it("never sends token to desktop offline HTTP server", async () => {
    const desktopTarget: ResolvedTarget = {
      type: "desktop-offline",
      displayLabel: "Saving to this computer (desktop app, offline)",
      transport: "http",
    };
    setCachedTarget(desktopTarget);

    let capturedHeaders: Headers | undefined;
    let capturedUrl: string | undefined;

    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify([{ id: "f_offline", name: "Offline Group" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const folders = await listFolders();
    expect(folders).toEqual([{ id: "f_offline", name: "Offline Group" }]);
    expect(capturedUrl).toContain("http://127.0.0.1:23456/api/folders");
    expect(capturedHeaders?.has("Authorization")).toBe(false);
  });

  it("sends token only to resolved webUrl when target is desktop-web", async () => {
    const webTarget: ResolvedTarget = {
      type: "desktop-web",
      displayLabel: "Saving to your account (via desktop app)",
      webUrl: "https://cloud.sourcefold.app",
      token: "secret_cloud_token_xyz",
    };
    setCachedTarget(webTarget);

    let capturedHeaders: Headers | undefined;
    let capturedUrl: string | undefined;

    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ data: [{ id: "f_cloud", name: "Cloud Group" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const folders = await listFolders();
    expect(folders).toEqual([{ id: "f_cloud", name: "Cloud Group" }]);
    expect(capturedUrl).toBe("https://cloud.sourcefold.app/api/folders");
    expect(capturedHeaders?.get("Authorization")).toBe("Bearer secret_cloud_token_xyz");
  });

  it("invalidates target cache on 401 Unauthorized", async () => {
    const webTarget: ResolvedTarget = {
      type: "desktop-web",
      displayLabel: "Saving to your account (via desktop app)",
      webUrl: "https://cloud.sourcefold.app",
      token: "invalid_expired_token",
    };
    setCachedTarget(webTarget);
    expect(getCachedTarget()).not.toBeNull();

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({ error: { message: "Invalid token", code: "unauthorized" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    });

    await expect(listFolders()).rejects.toThrow(ApiError);
    // Target cache must be invalidated on 401
    expect(getCachedTarget()).toBeNull();
  });

  it("invalidates target cache on network failure", async () => {
    const webTarget: ResolvedTarget = {
      type: "desktop-web",
      displayLabel: "Saving to your account (via desktop app)",
      webUrl: "https://cloud.sourcefold.app",
      token: "valid_token",
    };
    setCachedTarget(webTarget);
    expect(getCachedTarget()).not.toBeNull();

    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(listFolders()).rejects.toThrow(ApiError);
    // Target cache must be invalidated on network failure
    expect(getCachedTarget()).toBeNull();
  });
});
