import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Signed in, "remote" calls are the website's API run in the webview (`local-api.ts`). These pin
// how its answers reach the app, and when a 401 really means the sign-in is gone.

const invokeMock = vi.fn(async (_cmd: string, _args?: unknown) => undefined as unknown);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

const SUPABASE_SESSION = {
  access_token: "eyJ.access",
  expires_at: 1_900_000_000,
  user: { id: "user-1", email: "me@example.com" },
};
const auth = {
  session: null as typeof SUPABASE_SESSION | null,
  getSession: vi.fn(async () => ({ data: { session: auth.session } })),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(async () => {
    auth.session = null;
    return { error: null };
  }),
};
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ auth }),
  getSupabaseConfig: () => ({
    supabaseUrl: "https://project.supabase.co",
    supabasePublishableKey: "sb_publishable_x",
  }),
  isSupabaseConfigured: () => true,
}));

const localFetch = vi.fn();
vi.mock("@/lib/local-api", () => ({
  getLocalApi: () => ({ fetch: (path: string, init?: RequestInit) => localFetch(path, init) }),
  closeLocalApi: vi.fn(async () => {}),
  startLocalApiBridge: vi.fn(async () => {}),
}));
vi.mock("@/lib/utils", () => ({ openUrl: vi.fn() }));

import {
  SESSION_EXPIRED_MESSAGE,
  SessionExpiredError,
  clearExpiredSessionMessage,
  getExpiredSessionMessage,
  getSessionStatus,
  isRemoteConfigured,
  remoteFetch,
} from "@/lib/remote-client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("remote-client against the local API", () => {
  beforeEach(async () => {
    vi.stubGlobal("window", Object.assign(new EventTarget(), { __TAURI_INTERNALS__: {} }));
    clearExpiredSessionMessage();
    localFetch.mockReset();
    auth.session = SUPABASE_SESSION;
    await getSessionStatus(true);
    expect(isRemoteConfigured()).toBe(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unwraps { data } and passes JSON bodies with a content type", async () => {
    localFetch.mockResolvedValue(json({ data: [{ id: "f1" }] }));
    expect(await remoteFetch("/api/folders")).toEqual([{ id: "f1" }]);

    localFetch.mockResolvedValue(json({ data: { id: "f2" } }, 201));
    await remoteFetch("/api/folders", { method: "POST", body: JSON.stringify({ name: "New" }) });
    const [path, init] = localFetch.mock.calls.at(-1)!;
    expect(path).toBe("/api/folders");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("throws the API's own error message", async () => {
    localFetch.mockResolvedValue(
      json({ error: { message: "That folder no longer exists." } }, 400),
    );
    await expect(remoteFetch("/api/folders")).rejects.toThrow("That folder no longer exists.");
  });

  it("keeps the sign-in on Drive's own 401 and shows its message", async () => {
    localFetch.mockResolvedValue(
      json(
        { error: { code: "reconnect_drive", message: "Reconnect Google Drive to keep saving." } },
        401,
      ),
    );
    await expect(remoteFetch("/api/drive/save", { method: "POST" })).rejects.toThrow(
      "Reconnect Google Drive to keep saving.",
    );
    expect(isRemoteConfigured()).toBe(true);
  });

  it("ends the session once when Supabase has none any more", async () => {
    auth.session = null;
    localFetch.mockResolvedValue(json({ error: { message: "Sign in to continue." } }, 401));

    const results = await Promise.allSettled([
      remoteFetch("/api/folders"),
      remoteFetch("/api/items?folder=a"),
    ]);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(SessionExpiredError);
    }
    expect(isRemoteConfigured()).toBe(false);
    expect(getExpiredSessionMessage()).toBe(SESSION_EXPIRED_MESSAGE);

    const calls = localFetch.mock.calls.length;
    await expect(remoteFetch("/api/folders")).rejects.toThrow("No active remote session");
    expect(localFetch.mock.calls.length).toBe(calls);
  });
});
