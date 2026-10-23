import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Sign-in is Google through Supabase, straight from the desktop app (no website):
// docs/dev/handoff-no-website.md. Rust opens the listener (`start_sign_in` returns its port) and
// passes the browser's `?code=` back as `oauth-callback`; the webview finishes it.

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

const SUPABASE_SESSION = {
  access_token: "eyJ.access",
  refresh_token: "supabase-refresh",
  expires_at: 1_900_000_000,
  expires_in: 3600,
  provider_refresh_token: "google-refresh",
  user: { id: "user-1", email: "me@example.com" },
};

const auth = {
  session: null as typeof SUPABASE_SESSION | null,
  getSession: vi.fn(async () => ({ data: { session: auth.session } })),
  onAuthStateChange: vi.fn(),
  signInWithOAuth: vi.fn(async () => ({
    data: { url: "https://project.supabase.co/auth/v1/authorize?provider=google" },
    error: null as { message: string } | null,
  })),
  exchangeCodeForSession: vi.fn(async (_code: string) => {
    auth.session = SUPABASE_SESSION;
    return { data: { session: SUPABASE_SESSION }, error: null as { message: string } | null };
  }),
  signOut: vi.fn(async (_options?: unknown) => {
    auth.session = null;
    return { error: null };
  }),
};
const supabase = { auth, rpc: vi.fn(async () => ({ error: null })) };

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => supabase,
  getSupabaseConfig: () => ({
    supabaseUrl: "https://project.supabase.co",
    supabasePublishableKey: "sb_publishable_x",
  }),
  isSupabaseConfigured: () => true,
}));

const closeLocalApi = vi.fn(async (_options?: unknown) => {});
vi.mock("@/lib/local-api", () => ({
  getLocalApi: () => ({ fetch: vi.fn() }),
  closeLocalApi: (options?: unknown) => closeLocalApi(options),
  startLocalApiBridge: vi.fn(async () => {}),
}));

const openUrl = vi.fn(async (_url: string) => {});
vi.mock("@/lib/utils", () => ({ openUrl: (url: string) => openUrl(url) }));

import {
  cancelSignIn,
  getSessionStatus,
  isRemoteConfigured,
  isSignInCancelledError,
  setOfflineMode,
  signOut,
  startSignIn,
} from "@/lib/remote-client";

let fakeWindow: EventTarget & { __TAURI_INTERNALS__?: unknown };
let offline = false;

/** Plays the part of the Rust listener when the browser comes back. */
function browserReturns(code: string) {
  fakeWindow.dispatchEvent(new CustomEvent("sourcefold:oauth-callback", { detail: { code } }));
}

/** Waits until the app has opened the browser (start_sign_in, then Supabase, then openUrl). */
async function flush() {
  await vi.waitFor(() => expect(openUrl).toHaveBeenCalled());
}

describe("sign-in flow", () => {
  beforeEach(async () => {
    fakeWindow = Object.assign(new EventTarget(), { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("window", fakeWindow);
    auth.session = null;
    offline = false;
    for (const fn of [
      invokeMock,
      auth.signInWithOAuth,
      auth.exchangeCodeForSession,
      auth.signOut,
      supabase.rpc,
      openUrl,
      closeLocalApi,
    ]) {
      fn.mockClear();
    }
    invokeMock.mockReset();
    openUrl.mockClear();
    invokeMock.mockImplementation(async (cmd: string, args?: { offline?: boolean }) => {
      if (cmd === "start_sign_in") return 51234;
      if (cmd === "get_session") return { signedIn: false, offline, email: null, userId: null };
      if (cmd === "set_offline_mode") offline = Boolean(args?.offline);
      return undefined;
    });
    await getSessionStatus(true);
    invokeMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens Google through Supabase with the listener's port as the way back", async () => {
    const pending = startSignIn();
    await flush();

    expect(invokeMock).toHaveBeenCalledWith("start_sign_in", undefined);
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://127.0.0.1:51234/callback",
        skipBrowserRedirect: true,
        scopes: "https://www.googleapis.com/auth/drive.file",
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    expect(openUrl).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/authorize?provider=google",
    );

    browserReturns("the-code");
    const session = await pending;

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("the-code");
    expect(session).toMatchObject({ user_id: "user-1", email: "me@example.com" });
    expect(isRemoteConfigured()).toBe(true);
  });

  it("saves Google's refresh token for Drive and hands Rust only the access token", async () => {
    const pending = startSignIn();
    await flush();
    browserReturns("the-code");
    await pending;

    expect(supabase.rpc).toHaveBeenCalledWith("save_google_refresh_token", {
      p_refresh_token: "google-refresh",
    });
    const sessionSet = invokeMock.mock.calls.find(([cmd]) => cmd === "session_set");
    expect(sessionSet?.[1]).toEqual({
      session: {
        supabaseUrl: "https://project.supabase.co",
        publishableKey: "sb_publishable_x",
        accessToken: "eyJ.access",
        expiresAt: 1_900_000_000,
        userId: "user-1",
        email: "me@example.com",
      },
    });
    expect(JSON.stringify(sessionSet)).not.toContain("supabase-refresh");
    expect(invokeMock).toHaveBeenCalledWith("set_offline_mode", { offline: false });
  });

  it("rejects with the message from auth-error", async () => {
    const pending = startSignIn();
    await flush();
    fakeWindow.dispatchEvent(
      new CustomEvent("sourcefold:auth-error", {
        detail: { message: "This account can't use Sourcefold." },
      }),
    );
    await expect(pending).rejects.toThrow("This account can't use Sourcefold.");
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(isRemoteConfigured()).toBe(false);
  });

  it("rejects when the code can't be exchanged", async () => {
    auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null as never },
      error: { message: "invalid flow state" },
    });
    const pending = startSignIn();
    await flush();
    browserReturns("stale");
    await expect(pending).rejects.toThrow("invalid flow state");
    expect(isRemoteConfigured()).toBe(false);
  });

  it("cancel stops waiting and closes the listener", async () => {
    const pending = startSignIn();
    const outcome = pending.catch((e: unknown) => e);
    await flush();
    await cancelSignIn();
    const err = await outcome;
    expect(isSignInCancelledError(err)).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("cancel_sign_in", undefined);
  });

  it("reads the account from Supabase and offline mode from Rust", async () => {
    offline = true;
    expect(await getSessionStatus(true)).toMatchObject({ signedIn: false, offline: true });

    auth.session = SUPABASE_SESSION;
    expect(await getSessionStatus(true)).toMatchObject({
      signedIn: true,
      offline: false,
      email: "me@example.com",
      userId: "user-1",
    });
  });

  it("sends set_offline_mode { offline }", async () => {
    await setOfflineMode(true);
    expect(invokeMock).toHaveBeenCalledWith("set_offline_mode", { offline: true });
  });

  it("signs out of this computer only, after pushing pending changes to Drive", async () => {
    const pending = startSignIn();
    await flush();
    browserReturns("the-code");
    await pending;

    await signOut();
    expect(closeLocalApi).toHaveBeenCalledWith({ flush: true });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(invokeMock).toHaveBeenCalledWith("sign_out", undefined);
    expect(isRemoteConfigured()).toBe(false);
  });
});
