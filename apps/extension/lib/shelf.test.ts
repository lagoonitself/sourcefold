import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { browser } from "wxt/browser";
import type { ShelfLink } from "@sourcefold/core";
import {
  addToShelf,
  findShelfLink,
  listShelf,
  refreshShelfIndex,
  shelfBlockReason,
  updateShelfLink,
  SHELF_REFRESH_MS,
} from "./shelf";
import { serveAccountChannel } from "./account-channel";
import { invalidateTargetCache, type ResolvedTarget } from "./target";

const NOW = "2026-11-05T10:00:00.000Z";

function link(overrides: Partial<ShelfLink> = {}): ShelfLink {
  return {
    id: "s1",
    url: "https://example.com/docs",
    key: "example.com/docs",
    title: "Example docs",
    note: "",
    tags: [],
    pinned: false,
    open_count: 0,
    last_opened_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function json(status: number, body: unknown) {
  return { status, body: JSON.stringify(body) };
}

/** Lets the background refresh that addToShelf starts finish before a test looks at requests. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("shelf through the account", () => {
  const originalFetch = globalThis.fetch;
  let seen: { path: string; method?: string; body?: string }[];
  let answer: (path: string, method: string, body?: string) => { status: number; body: string };

  beforeEach(async () => {
    await flush();
    invalidateTargetCache();
    await browser.storage.local.clear();
    seen = [];
    answer = () => json(200, { data: [] });
    const accountTarget: ResolvedTarget = {
      type: "account",
      via: "extension",
      displayLabel: "Saving to your account",
    };
    serveAccountChannel({
      resolveTarget: async () => accountTarget,
      fetch: async (request) => {
        seen.push(request);
        return answer(request.path, request.method ?? "GET", request.body);
      },
      status: async () => ({ signedIn: true }),
      signIn: async () => ({ signedIn: true }),
      signOut: async () => {},
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    invalidateTargetCache();
  });

  it("lists the shelf and unwraps the data", async () => {
    answer = () => json(200, { data: [link()] });
    expect(await listShelf()).toEqual([link()]);
    expect(seen).toEqual([{ path: "/api/shelf", method: "GET", body: undefined }]);
  });

  it("posts the link in a { links } body and caches what comes back", async () => {
    const added = link();
    answer = () => json(200, { data: { added: [added], existing: [] } });

    const result = await addToShelf({ url: "https://example.com/docs", title: "Example docs" });

    expect(result.added).toEqual([added]);
    expect(seen[0]).toEqual({
      path: "/api/shelf",
      method: "POST",
      body: JSON.stringify({
        links: [{ url: "https://example.com/docs", title: "Example docs" }],
      }),
    });
    expect(await findShelfLink("https://example.com/docs/")).toEqual(added);
  });

  it("patches one link by id and updates the cached copy", async () => {
    answer = (path) => {
      if (path === "/api/shelf/s1") return json(200, { data: link({ note: "Read first" }) });
      return json(200, { data: { added: [link()], existing: [] } });
    };
    await addToShelf({ url: "https://example.com/docs" });

    await flush();
    seen = [];
    const updated = await updateShelfLink("s1", { note: "Read first" });

    expect(updated.note).toBe("Read first");
    expect(seen[0]).toEqual({
      path: "/api/shelf/s1",
      method: "PATCH",
      body: JSON.stringify({ note: "Read first" }),
    });
    expect((await findShelfLink("https://example.com/docs"))?.note).toBe("Read first");
  });

  it("reports the server's error message", async () => {
    answer = () => json(400, { error: { message: "That isn't a web address." } });
    await expect(addToShelf({ url: "ftp://nope" })).rejects.toThrow("That isn't a web address.");
  });

  it("reads the cache only, never the network", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    expect(await findShelfLink("https://example.com/docs")).toBeUndefined();
    expect(await findShelfLink("chrome://extensions")).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
  });

  it("refreshes the index at most every five minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60 * 60_000);
    answer = () => json(200, { data: [link({ note: "Kept" })] });

    await refreshShelfIndex();
    expect(seen.filter((r) => r.path === "/api/shelf")).toHaveLength(1);
    expect((await findShelfLink("https://example.com/docs"))?.note).toBe("Kept");

    await refreshShelfIndex();
    expect(seen).toHaveLength(1);

    vi.setSystemTime(Date.now() + SHELF_REFRESH_MS + 1000);
    await refreshShelfIndex();
    expect(seen).toHaveLength(2);

    await refreshShelfIndex({ force: true });
    expect(seen).toHaveLength(3);
  });
});

describe("shelf while the desktop app is offline", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    invalidateTargetCache();
    await browser.storage.local.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    invalidateTargetCache();
  });

  it("calls the loopback server and never sends a token", async () => {
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

    let url = "";
    let headers: Headers | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (input, init) => {
      url = String(input);
      headers = new Headers(init?.headers);
      return new Response(JSON.stringify({ data: { added: [link()], existing: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await addToShelf({ url: "https://example.com/docs" });
    expect(result.added).toEqual([link()]);
    expect(url).toBe("http://127.0.0.1:23456/api/shelf");
    expect(headers?.has("Authorization")).toBe(false);
  });
});

describe("shelfBlockReason", () => {
  it("allows ordinary web pages", () => {
    expect(shelfBlockReason("https://example.com/a?b=1")).toBeNull();
  });

  it("blocks non-web pages and the Chrome Web Store", () => {
    expect(shelfBlockReason("chrome://extensions")).toMatch(/http or https/);
    expect(shelfBlockReason("")).toMatch(/http or https/);
    expect(shelfBlockReason("https://chromewebstore.google.com/detail/x")).toMatch(/Web Store/);
    expect(shelfBlockReason("https://chrome.google.com/webstore/detail/x")).toMatch(/Web Store/);
  });
});
