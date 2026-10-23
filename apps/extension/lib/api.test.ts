import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { unwrapResponse, listFolders, createFolder, ApiError } from "./api";
import { serveAccountChannel } from "./account-channel";
import { invalidateTargetCache, type ResolvedTarget } from "./target";

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
    serveAccountChannel({
      resolveTarget: async () => desktopTarget,
      fetch: async () => {
        throw new Error("not the account");
      },
      status: async () => ({ signedIn: false }),
      signIn: async () => ({ signedIn: true }),
      signOut: async () => {},
    });

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

  it("sends account requests to the background, never to the network", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    const seen: unknown[] = [];
    serveAccountChannel({
      resolveTarget: async () => ({
        type: "account",
        via: "extension",
        displayLabel: "Saving to your account",
      }),
      fetch: async (request) => {
        seen.push(request);
        if (request.method === "POST") {
          return {
            status: 409,
            body: JSON.stringify({
              error: { message: "Already saved", code: "duplicate", folder_name: "Cars" },
            }),
          };
        }
        return { status: 200, body: JSON.stringify({ data: [{ id: "f1", name: "Cloud" }] }) };
      },
      status: async () => ({ signedIn: true }),
      signIn: async () => ({ signedIn: true }),
      signOut: async () => {},
    });

    expect(await listFolders()).toEqual([{ id: "f1", name: "Cloud" }]);
    const err = await createFolder({ name: "New" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "duplicate", folderName: "Cars" });
    expect(seen).toEqual([
      { path: "/api/folders", method: "GET", body: undefined },
      { path: "/api/folders", method: "POST", body: JSON.stringify({ name: "New" }) },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
