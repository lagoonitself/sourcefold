import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  parseSessionResponse,
  resolveTarget,
  invalidateTargetCache,
  getCachedTarget,
  type TargetResolverDeps,
} from "./target";
import { normalizeConnectionMode, getSettings } from "./settings";
import { browser } from "wxt/browser";

const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

function desktopSession(overrides: Record<string, unknown> = {}) {
  return {
    signedIn: true,
    supabaseUrl: "https://abc.supabase.co/",
    supabasePublishableKey: "sb_publishable_123",
    accessToken: "eyJ.desktop.token",
    expiresAt: inAnHour(),
    userId: "user-1",
    email: "alice@example.com",
    ...overrides,
  };
}

const AUTO = { connectionMode: "auto" } as const;
const DESKTOP = { connectionMode: "desktop" } as const;

const nothing: TargetResolverDeps = {
  queryDesktopNative: async () => null,
  queryDesktopHttp: async () => null,
  pingDesktopNative: async () => false,
  pingDesktopHttp: async () => false,
};

describe("Session Response Parser", () => {
  it("parses the desktop app's sign-in, wrapped or bare", () => {
    const expected = {
      signedIn: true,
      supabaseUrl: "https://abc.supabase.co",
      supabasePublishableKey: "sb_publishable_123",
      accessToken: "eyJ.desktop.token",
      expiresAt: expect.any(Number),
      userId: "user-1",
      email: "alice@example.com",
    };
    expect(parseSessionResponse({ data: desktopSession() })).toEqual(expected);
    expect(parseSessionResponse(desktopSession())).toEqual(expected);
    expect(parseSessionResponse(desktopSession({ email: null }))).toMatchObject({
      email: undefined,
    });
  });

  it("parses signedIn: false wrapped and bare", () => {
    expect(parseSessionResponse({ data: { signedIn: false } })).toEqual({ signedIn: false });
    expect(parseSessionResponse({ signedIn: false })).toEqual({ signedIn: false });
  });

  it("reads an old desktop app's { webUrl, token } answer as unreadable", () => {
    expect(
      parseSessionResponse({ signedIn: true, webUrl: "https://a.example", token: "sf_1" }),
    ).toBeNull();
  });

  it("returns null for malformed or missing data", () => {
    expect(parseSessionResponse(null)).toBeNull();
    expect(parseSessionResponse({})).toBeNull();
    expect(parseSessionResponse({ signedIn: "yes" })).toBeNull();
    expect(parseSessionResponse(desktopSession({ accessToken: "" }))).toBeNull();
    expect(parseSessionResponse(desktopSession({ userId: undefined }))).toBeNull();
    expect(parseSessionResponse(desktopSession({ expiresAt: "soon" }))).toBeNull();
  });
});

describe("Settings Migration and Normalization", () => {
  it("reads legacy and website modes as auto or desktop", () => {
    expect(normalizeConnectionMode("native")).toBe("desktop");
    expect(normalizeConnectionMode("http")).toBe("desktop");
    expect(normalizeConnectionMode("desktop")).toBe("desktop");
    expect(normalizeConnectionMode("web")).toBe("auto");
    expect(normalizeConnectionMode("auto")).toBe("auto");
    expect(normalizeConnectionMode(undefined)).toBe("auto");
    expect(normalizeConnectionMode("invalid")).toBe("auto");
  });

  it("stores the migrated mode and drops the old website address and token", async () => {
    await (browser.storage.local as any).clear();
    await browser.storage.local.set({
      connectionMode: "web",
      appUrl: "https://a.example",
      token: "sf_1",
    });

    expect(await getSettings()).toEqual({ connectionMode: "auto" });
    expect(await browser.storage.local.get(["connectionMode", "appUrl", "token"])).toEqual({
      connectionMode: "auto",
    });
  });
});

describe("Target Resolution", () => {
  beforeEach(() => {
    invalidateTargetCache();
  });

  it("uses the extension's own sign-in first in auto mode, without asking the desktop", async () => {
    const queryDesktopNative = vi.fn(async () => ({ signedIn: false }));
    const target = await resolveTarget({
      forceRefresh: true,
      settings: AUTO,
      deps: {
        ...nothing,
        queryDesktopNative,
        getOwnAccount: async () => ({ userId: "u1", email: "me@example.com" }),
      },
    });
    expect(target).toEqual({
      type: "account",
      via: "extension",
      displayLabel: "Saving to your account (me@example.com)",
      email: "me@example.com",
    });
    expect(queryDesktopNative).not.toHaveBeenCalled();
  });

  it("ignores the extension's own sign-in in desktop mode", async () => {
    const target = await resolveTarget({
      forceRefresh: true,
      settings: DESKTOP,
      deps: {
        ...nothing,
        queryDesktopHttp: async () => ({ data: { signedIn: false } }),
        getOwnAccount: async () => ({ userId: "u1" }),
      },
    });
    expect(target).toMatchObject({ type: "desktop-offline", transport: "http" });
  });

  it("borrows the desktop app's sign-in and hands its token to the background only", async () => {
    const onDesktopSession = vi.fn();
    const target = await resolveTarget({
      forceRefresh: true,
      settings: AUTO,
      deps: { ...nothing, queryDesktopNative: async () => desktopSession(), onDesktopSession },
    });
    expect(target).toEqual({
      type: "account",
      via: "desktop",
      displayLabel: "Saving to your account (alice@example.com, desktop app's sign-in)",
      email: "alice@example.com",
    });
    expect(JSON.stringify(target)).not.toContain("eyJ");
    expect(onDesktopSession).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "eyJ.desktop.token", userId: "user-1" }),
    );
  });

  it("prefers the running app's fresh token over the native host's stale file", async () => {
    const onDesktopSession = vi.fn();
    const target = await resolveTarget({
      forceRefresh: true,
      settings: AUTO,
      deps: {
        ...nothing,
        queryDesktopNative: async () => desktopSession({ accessToken: "old", expiresAt: 10 }),
        queryDesktopHttp: async () =>
          new Promise((resolve) => setTimeout(() => resolve(desktopSession()), 10)),
        onDesktopSession,
      },
    });
    expect(target).toMatchObject({ type: "account", via: "desktop" });
    expect(onDesktopSession.mock.calls[0]![0].accessToken).toBe("eyJ.desktop.token");
  });

  it("says the desktop's sign-in expired when only a stale token is there, and doesn't cache it", async () => {
    const target = await resolveTarget({
      forceRefresh: true,
      settings: AUTO,
      deps: { ...nothing, queryDesktopNative: async () => desktopSession({ expiresAt: 10 }) },
    });
    expect(target.type).toBe("error");
    expect(target.displayLabel).toContain("expired");
    expect(getCachedTarget()).toBeNull();
  });

  it("saves to the desktop's offline library when it is signed out", async () => {
    const target = await resolveTarget({
      forceRefresh: true,
      settings: AUTO,
      deps: { ...nothing, queryDesktopNative: async () => ({ signedIn: false }) },
    });
    expect(target).toMatchObject({ type: "desktop-offline", transport: "native" });
  });

  it("explains an old desktop app that answers but can't share its sign-in", async () => {
    const target = await resolveTarget({
      forceRefresh: true,
      settings: AUTO,
      deps: {
        ...nothing,
        queryDesktopHttp: async () => ({ signedIn: true, webUrl: "https://a.example", token: "t" }),
        pingDesktopHttp: async () => true,
      },
    });
    expect(target.type).toBe("error");
    expect(target.displayLabel).toContain("too old");
    expect(getCachedTarget()).toBeNull();
  });

  it("asks to sign in when nothing is there, or to open the app in desktop mode", async () => {
    const auto = await resolveTarget({ forceRefresh: true, settings: AUTO, deps: nothing });
    expect(auto).toMatchObject({ type: "signed-out", reason: "signed_out" });

    const desktop = await resolveTarget({ forceRefresh: true, settings: DESKTOP, deps: nothing });
    expect(desktop).toMatchObject({ type: "signed-out", reason: "desktop_not_reachable" });
  });

  it("caches a resolved target until forced", async () => {
    const getOwnAccount = vi.fn(async () => ({ userId: "u1" }));
    await resolveTarget({
      forceRefresh: true,
      settings: AUTO,
      deps: { ...nothing, getOwnAccount },
    });
    await resolveTarget({ settings: AUTO, deps: { ...nothing, getOwnAccount } });
    expect(getOwnAccount).toHaveBeenCalledTimes(1);
    await resolveTarget({
      forceRefresh: true,
      settings: AUTO,
      deps: { ...nothing, getOwnAccount },
    });
    expect(getOwnAccount).toHaveBeenCalledTimes(2);
  });
});
