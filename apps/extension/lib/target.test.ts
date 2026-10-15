import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  parseSessionResponse,
  resolveTarget,
  invalidateTargetCache,
  getCachedTarget,
  setCachedTarget,
  formatWebHostLabel,
  type ResolvedTarget,
} from "./target";
import { normalizeConnectionMode, getSettings, saveSettings } from "./settings";
import { browser } from "wxt/browser";

describe("Session Response Parser", () => {
  it("parses wrapped { data: { signedIn: true, ... } }", () => {
    const raw = {
      data: {
        signedIn: true,
        webUrl: "https://sourcefold.example.com",
        token: "sf_token_123",
        email: "alice@example.com",
      },
    };
    const session = parseSessionResponse(raw);
    expect(session).toEqual({
      signedIn: true,
      webUrl: "https://sourcefold.example.com",
      token: "sf_token_123",
      email: "alice@example.com",
    });
  });

  it("parses bare { signedIn: true, ... }", () => {
    const raw = {
      signedIn: true,
      webUrl: "https://app.sourcefold.com/",
      token: "sf_secret_abc",
    };
    const session = parseSessionResponse(raw);
    expect(session).toEqual({
      signedIn: true,
      webUrl: "https://app.sourcefold.com",
      token: "sf_secret_abc",
      email: undefined,
    });
  });

  it("parses signedIn: false wrapped and bare", () => {
    expect(parseSessionResponse({ data: { signedIn: false } })).toEqual({
      signedIn: false,
    });
    expect(parseSessionResponse({ signedIn: false })).toEqual({
      signedIn: false,
    });
  });

  it("returns null for malformed or missing signedIn data", () => {
    expect(parseSessionResponse(null)).toBeNull();
    expect(parseSessionResponse({})).toBeNull();
    expect(parseSessionResponse({ signedIn: "yes" })).toBeNull();
    // Missing token or webUrl when signedIn is true
    expect(parseSessionResponse({ signedIn: true, webUrl: "https://abc.com" })).toBeNull();
    expect(parseSessionResponse({ signedIn: true, token: "sf_123" })).toBeNull();
    expect(parseSessionResponse({ signedIn: true, webUrl: "", token: "sf_123" })).toBeNull();
  });
});

describe("Settings Migration and Normalization", () => {
  it("migrates legacy 'native' to 'desktop'", () => {
    expect(normalizeConnectionMode("native")).toBe("desktop");
  });

  it("migrates legacy 'http' to 'desktop'", () => {
    expect(normalizeConnectionMode("http")).toBe("desktop");
  });

  it("preserves canonical modes", () => {
    expect(normalizeConnectionMode("auto")).toBe("auto");
    expect(normalizeConnectionMode("desktop")).toBe("desktop");
    expect(normalizeConnectionMode("web")).toBe("web");
  });

  it("defaults unknown or null modes to 'auto'", () => {
    expect(normalizeConnectionMode(undefined)).toBe("auto");
    expect(normalizeConnectionMode(null)).toBe("auto");
    expect(normalizeConnectionMode("invalid")).toBe("auto");
  });

  it("persists migrated settings to storage", async () => {
    await (browser.storage.local as any).clear();
    await (browser.storage.local as any).set({ connectionMode: "native" });

    const loaded = await getSettings();
    expect(loaded.connectionMode).toBe("desktop");

    // Check that storage was updated
    const inStorage = await browser.storage.local.get(["connectionMode"]);
    expect(inStorage.connectionMode).toBe("desktop");
  });
});

describe("Format Web Host Label", () => {
  it("formats standard hosts correctly", () => {
    expect(formatWebHostLabel("https://sourcefold.app")).toBe("Saving to sourcefold.app");
    expect(formatWebHostLabel("http://localhost:3000")).toBe("Saving to localhost:3000");
  });
});

describe("Target Resolution in Auto Mode", () => {
  beforeEach(() => {
    invalidateTargetCache();
  });

  it("Case 1: Desktop signed in -> resolves to desktop-web with session token and webUrl", async () => {
    const deps = {
      queryDesktopNative: async () => ({
        signedIn: true,
        webUrl: "https://my-cloud.sourcefold.com",
        token: "sf_user_token",
        email: "alice@example.com",
      }),
      queryDesktopHttp: async () => null,
      pingDesktopNative: async () => true,
      pingDesktopHttp: async () => true,
    };

    const target = await resolveTarget({
      forceRefresh: true,
      settings: { appUrl: "http://localhost:3000", token: "", connectionMode: "auto" },
      deps,
    });

    expect(target).toEqual({
      type: "desktop-web",
      displayLabel: "Saving to your account (via desktop app)",
      webUrl: "https://my-cloud.sourcefold.com",
      token: "sf_user_token",
      email: "alice@example.com",
    });
  });

  it("Case 2: Desktop reachable but not signed in -> resolves to desktop-offline", async () => {
    const deps = {
      queryDesktopNative: async () => ({
        signedIn: false,
      }),
      queryDesktopHttp: async () => null,
      pingDesktopNative: async () => true,
      pingDesktopHttp: async () => true,
    };

    const target = await resolveTarget({
      forceRefresh: true,
      settings: { appUrl: "http://localhost:3000", token: "", connectionMode: "auto" },
      deps,
    });

    expect(target).toEqual({
      type: "desktop-offline",
      displayLabel: "Saving to this computer (desktop app, offline)",
      transport: "native",
    });
  });

  it("Case 2 fallback: Desktop local HTTP reachable but not signed in -> resolves to desktop-offline via http", async () => {
    const deps = {
      queryDesktopNative: async () => null,
      queryDesktopHttp: async () => ({
        signedIn: false,
      }),
      pingDesktopNative: async () => false,
      pingDesktopHttp: async () => true,
    };

    const target = await resolveTarget({
      forceRefresh: true,
      settings: { appUrl: "http://localhost:3000", token: "", connectionMode: "auto" },
      deps,
    });

    expect(target).toEqual({
      type: "desktop-offline",
      displayLabel: "Saving to this computer (desktop app, offline)",
      transport: "http",
    });
  });

  it("Case 2 error: Desktop reachable but session cannot be read -> resolves to error target without caching", async () => {
    const queryDesktopNative = vi.fn().mockResolvedValue(null);
    const queryDesktopHttp = vi.fn().mockResolvedValue(null);
    const pingDesktopNative = vi.fn().mockResolvedValue(true);

    const target = await resolveTarget({
      forceRefresh: true,
      settings: { appUrl: "http://localhost:3000", token: "", connectionMode: "auto" },
      deps: {
        queryDesktopNative,
        queryDesktopHttp,
        pingDesktopNative,
        pingDesktopHttp: async () => false,
      },
    });

    expect(target).toEqual({
      type: "error",
      displayLabel: "Can't read the desktop app's sign-in. Open Options to fix it.",
      error: "Can't read the desktop app's sign-in. Open Options to fix it.",
    });

    // Verify it is NOT cached
    expect(getCachedTarget()).toBeNull();

    // Subsequent resolution queries again
    await resolveTarget({
      settings: { appUrl: "http://localhost:3000", token: "", connectionMode: "auto" },
      deps: {
        queryDesktopNative,
        queryDesktopHttp,
        pingDesktopNative,
        pingDesktopHttp: async () => false,
      },
    });
    expect(queryDesktopNative).toHaveBeenCalledTimes(2);
  });

  it("Case 2 error fallback: Desktop HTTP reachable but session cannot be read -> resolves to error target", async () => {
    const deps = {
      queryDesktopNative: async () => null,
      queryDesktopHttp: async () => null,
      pingDesktopNative: async () => false,
      pingDesktopHttp: async () => true,
    };

    const target = await resolveTarget({
      forceRefresh: true,
      settings: { appUrl: "http://localhost:3000", token: "", connectionMode: "auto" },
      deps,
    });

    expect(target).toEqual({
      type: "error",
      displayLabel: "Can't read the desktop app's sign-in. Open Options to fix it.",
      error: "Can't read the desktop app's sign-in. Open Options to fix it.",
    });
    expect(getCachedTarget()).toBeNull();
  });

  it("Case 3: Desktop unreachable, web app configured -> resolves to web target", async () => {
    const deps = {
      queryDesktopNative: async () => null,
      queryDesktopHttp: async () => null,
      pingDesktopNative: async () => false,
      pingDesktopHttp: async () => false,
    };

    const target = await resolveTarget({
      forceRefresh: true,
      settings: {
        appUrl: "https://app.sourcefold.com",
        token: "sf_web_token_999",
        connectionMode: "auto",
      },
      deps,
    });

    expect(target).toEqual({
      type: "web",
      displayLabel: "Saving to app.sourcefold.com",
      webUrl: "https://app.sourcefold.com",
      token: "sf_web_token_999",
    });
  });

  it("Case 4: Desktop unreachable, web app not configured -> unconfigured state", async () => {
    const deps = {
      queryDesktopNative: async () => null,
      queryDesktopHttp: async () => null,
      pingDesktopNative: async () => false,
      pingDesktopHttp: async () => false,
    };

    const target = await resolveTarget({
      forceRefresh: true,
      settings: {
        appUrl: "http://localhost:3000",
        token: "", // No token configured
        connectionMode: "auto",
      },
      deps,
    });

    expect(target.type).toBe("unconfigured");
    expect(target.displayLabel).toBe(
      "Open the Sourcefold desktop app or set up the web app in Options",
    );
  });
});

describe("Explicit Connection Modes", () => {
  beforeEach(() => {
    invalidateTargetCache();
  });

  it("Desktop app only mode: resolves desktop even when web is configured", async () => {
    const deps = {
      queryDesktopNative: async () => ({
        signedIn: false,
      }),
      queryDesktopHttp: async () => null,
      pingDesktopNative: async () => true,
      pingDesktopHttp: async () => true,
    };

    const target = await resolveTarget({
      forceRefresh: true,
      settings: {
        appUrl: "https://app.sourcefold.com",
        token: "sf_configured_token",
        connectionMode: "desktop",
      },
      deps,
    });

    expect(target.type).toBe("desktop-offline");
  });

  it("Desktop app only mode: resolves to error target when desktop is reachable but session cannot be read", async () => {
    const deps = {
      queryDesktopNative: async () => null,
      queryDesktopHttp: async () => null,
      pingDesktopNative: async () => true,
      pingDesktopHttp: async () => false,
    };

    const target = await resolveTarget({
      forceRefresh: true,
      settings: {
        appUrl: "https://app.sourcefold.com",
        token: "sf_configured_token",
        connectionMode: "desktop",
      },
      deps,
    });

    expect(target).toEqual({
      type: "error",
      displayLabel: "Can't read the desktop app's sign-in. Open Options to fix it.",
      error: "Can't read the desktop app's sign-in. Open Options to fix it.",
    });
    expect(getCachedTarget()).toBeNull();
  });

  it("Desktop app only mode: fails if desktop is unreachable, does not fallback to web", async () => {
    const deps = {
      queryDesktopNative: async () => null,
      queryDesktopHttp: async () => null,
      pingDesktopNative: async () => false,
      pingDesktopHttp: async () => false,
    };

    const target = await resolveTarget({
      forceRefresh: true,
      settings: {
        appUrl: "https://app.sourcefold.com",
        token: "sf_configured_token",
        connectionMode: "desktop",
      },
      deps,
    });

    expect(target.type).toBe("unconfigured");
    expect((target as any).reason).toBe("desktop_not_reachable");
  });

  it("Web app only mode: resolves web target directly and never calls desktop", async () => {
    const queryDesktopNative = vi.fn();
    const queryDesktopHttp = vi.fn();

    const target = await resolveTarget({
      forceRefresh: true,
      settings: {
        appUrl: "https://app.sourcefold.com",
        token: "sf_web_token_abc",
        connectionMode: "web",
      },
      deps: {
        queryDesktopNative,
        queryDesktopHttp,
      },
    });

    expect(target.type).toBe("web");
    expect(target.displayLabel).toBe("Saving to app.sourcefold.com");
    expect(queryDesktopNative).not.toHaveBeenCalled();
    expect(queryDesktopHttp).not.toHaveBeenCalled();
  });

  it("Web app only mode: unconfigured if token or appUrl missing", async () => {
    const target = await resolveTarget({
      forceRefresh: true,
      settings: {
        appUrl: "https://app.sourcefold.com",
        token: "",
        connectionMode: "web",
      },
    });

    expect(target.type).toBe("unconfigured");
    expect((target as any).reason).toBe("web_not_configured");
  });
});

describe("Target Caching and Invalidation", () => {
  beforeEach(() => {
    invalidateTargetCache();
  });

  it("returns cached target on consecutive calls within TTL", async () => {
    const queryDesktopNative = vi.fn().mockResolvedValue({
      signedIn: true,
      webUrl: "https://app.sourcefold.com",
      token: "sf_token",
    });

    const target1 = await resolveTarget({
      settings: { appUrl: "", token: "", connectionMode: "auto" },
      deps: { queryDesktopNative },
    });

    expect(target1.type).toBe("desktop-web");
    expect(queryDesktopNative).toHaveBeenCalledTimes(1);

    // Second call without forceRefresh should use cache
    const target2 = await resolveTarget({
      settings: { appUrl: "", token: "", connectionMode: "auto" },
      deps: { queryDesktopNative },
    });

    expect(target2).toEqual(target1);
    expect(queryDesktopNative).toHaveBeenCalledTimes(1); // Not called again!
  });

  it("re-resolves target after invalidateTargetCache() is called", async () => {
    const queryDesktopNative = vi.fn().mockResolvedValue({
      signedIn: false,
    });

    await resolveTarget({
      settings: { appUrl: "", token: "", connectionMode: "auto" },
      deps: { queryDesktopNative },
    });
    expect(queryDesktopNative).toHaveBeenCalledTimes(1);

    invalidateTargetCache();

    await resolveTarget({
      settings: { appUrl: "", token: "", connectionMode: "auto" },
      deps: { queryDesktopNative },
    });
    expect(queryDesktopNative).toHaveBeenCalledTimes(2);
  });
});
