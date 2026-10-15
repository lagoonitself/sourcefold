import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_EXPIRED_MESSAGE,
  SessionExpiredError,
  clearExpiredSessionMessage,
  getExpiredSessionMessage,
  getRemoteConfig,
  getSessionStatus,
  isRemoteConfigured,
  remoteFetch,
  setOfflineMode,
  signOut,
  startSignIn,
  testRemoteConnection,
} from "@/lib/remote-client";

describe("remote-client auth and session", () => {
  beforeAll(() => {
    if (typeof globalThis.localStorage === "undefined") {
      const store = new Map<string, string>();
      globalThis.localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, String(v));
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => {
          store.clear();
        },
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        length: 0,
      };
    }
  });

  beforeEach(async () => {
    globalThis.localStorage.clear();
    await signOut();
  });

  it("reports not configured initially", async () => {
    const status = await getSessionStatus(true);
    expect(status.signedIn).toBe(false);
    expect(isRemoteConfigured()).toBe(false);
    expect(getRemoteConfig().apiToken).toBe("");
  });

  it("handles offline mode toggling", async () => {
    await setOfflineMode(true);
    const status = await getSessionStatus(true);
    expect(status.offline).toBe(true);

    await setOfflineMode(false);
    const statusAfter = await getSessionStatus(true);
    expect(statusAfter.offline).toBe(false);
  });

  it("validates remote connection input parameters", async () => {
    const resNoUrl = await testRemoteConnection("", "token123");
    expect(resNoUrl.ok).toBe(false);
    expect(resNoUrl.message).toContain("Web App URL is required");

    const resNoToken = await testRemoteConnection("http://localhost:3000", "");
    expect(resNoToken.ok).toBe(false);
    expect(resNoToken.message).toContain("Personal Access Token is required");

    const resInvalidUrl = await testRemoteConnection("not-a-valid-url", "token123");
    expect(resInvalidUrl.ok).toBe(false);
    expect(resInvalidUrl.message).toContain("Invalid Web App URL format");
  });

  describe("expired or revoked token (HTTP 401)", () => {
    const fetchMock = vi.fn();

    beforeEach(async () => {
      clearExpiredSessionMessage();
      fetchMock.mockReset();
      vi.stubGlobal("fetch", fetchMock);
      await startSignIn("http://localhost:3000");
      expect(isRemoteConfigured()).toBe(true);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const unauthorized = () => new Response(JSON.stringify({ error: "nope" }), { status: 401 });

    it("clears the session once and reports that sign-in expired", async () => {
      fetchMock.mockResolvedValue(unauthorized());

      const results = await Promise.allSettled([
        remoteFetch("/api/folders"),
        remoteFetch("/api/items?folder=a"),
        remoteFetch("/api/items?folder=b"),
      ]);

      for (const result of results) {
        expect(result.status).toBe("rejected");
        expect((result as PromiseRejectedResult).reason).toBeInstanceOf(SessionExpiredError);
      }
      expect(isRemoteConfigured()).toBe(false);
      expect(globalThis.localStorage.getItem("sourcefold:pat_token")).toBeNull();
      expect(getExpiredSessionMessage()).toBe(SESSION_EXPIRED_MESSAGE);
      expect(SESSION_EXPIRED_MESSAGE).toBe("Your sign-in expired. Sign in again.");
    });

    it("stops calling the server after the session is cleared", async () => {
      fetchMock.mockResolvedValue(unauthorized());
      await expect(remoteFetch("/api/folders")).rejects.toBeInstanceOf(SessionExpiredError);
      const callsAfterExpiry = fetchMock.mock.calls.length;

      await expect(remoteFetch("/api/folders")).rejects.toThrow("No active remote session");
      expect(fetchMock.mock.calls.length).toBe(callsAfterExpiry);
    });

    it("does not sign out a newer session because of a late 401 for the old token", async () => {
      let answerOldRequest: (res: Response) => void = () => {};
      fetchMock.mockImplementationOnce(
        () => new Promise<Response>((resolve) => (answerOldRequest = resolve)),
      );
      const oldRequest = remoteFetch("/api/folders");
      const oldToken = getRemoteConfig().apiToken;

      await signOut();
      await new Promise((resolve) => setTimeout(resolve, 5));
      await startSignIn("http://localhost:3000");
      expect(getRemoteConfig().apiToken).not.toBe(oldToken);

      answerOldRequest(unauthorized());
      await expect(oldRequest).rejects.toBeInstanceOf(SessionExpiredError);
      expect(isRemoteConfigured()).toBe(true);
    });
  });
});
