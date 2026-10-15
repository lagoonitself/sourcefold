import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

import {
  cancelSignIn,
  getSessionStatus,
  isRemoteConfigured,
  isSignInCancelledError,
  setOfflineMode,
  startSignIn,
} from "@/lib/remote-client";

// What the Rust `get_session` command returns (camelCase, see `SessionStatus` in commands/auth.rs).
const signedInStatus = {
  signedIn: true,
  webUrl: "https://app.example.com",
  email: "me@example.com",
  token: "sf_token",
  offline: false,
};
const signedOutStatus = {
  signedIn: false,
  webUrl: null,
  email: null,
  token: null,
  offline: false,
};

let fakeWindow: EventTarget & { __TAURI_INTERNALS__?: unknown };
let currentStatus: typeof signedInStatus | typeof signedOutStatus;

/** Plays the part of the Rust listener: refresh the cached session, then announce it. */
async function rustReports(event: "auth-changed" | "auth-error", payload?: string) {
  if (event === "auth-changed") {
    await getSessionStatus(true);
    fakeWindow.dispatchEvent(new Event("sourcefold:auth-changed"));
  } else {
    fakeWindow.dispatchEvent(
      new CustomEvent("sourcefold:auth-error", { detail: { message: payload } }),
    );
  }
}

describe("sign-in flow against the Tauri commands", () => {
  beforeEach(async () => {
    fakeWindow = Object.assign(new EventTarget(), { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("window", fakeWindow);
    currentStatus = signedOutStatus;
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_session") return currentStatus;
      return undefined;
    });
    await getSessionStatus(true);
    invokeMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the camelCase session returned by get_session", async () => {
    currentStatus = signedInStatus;
    const status = await getSessionStatus(true);
    expect(status).toMatchObject({ signedIn: true, email: "me@example.com", offline: false });
    expect(isRemoteConfigured()).toBe(true);
  });

  it("sends set_offline_mode { offline }", async () => {
    await setOfflineMode(true);
    expect(invokeMock).toHaveBeenCalledWith("set_offline_mode", { offline: true });
  });

  it("treats start_sign_in as 'browser opened' and finishes on auth-changed", async () => {
    let settled = false;
    const pending = startSignIn("https://app.example.com").then((session) => {
      settled = true;
      return session;
    });

    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("start_sign_in", {
        webUrl: "https://app.example.com",
      }),
    );
    // start_sign_in returned (undefined), but the session does not exist yet.
    await Promise.resolve();
    expect(settled).toBe(false);

    currentStatus = signedInStatus;
    await rustReports("auth-changed");

    const session = await pending;
    expect(session).toMatchObject({
      web_url: "https://app.example.com",
      token: "sf_token",
      email: "me@example.com",
    });
  });

  it("rejects with the message from auth-error", async () => {
    const outcome = startSignIn("https://app.example.com").catch((e) => e);
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("start_sign_in", expect.anything()),
    );

    await rustReports("auth-error", "Sign-in timed out. Try again.");
    expect(await outcome).toEqual(new Error("Sign-in timed out. Try again."));
  });

  it("cancel stops waiting and calls cancel_sign_in", async () => {
    const outcome = startSignIn("https://app.example.com").catch((e) => e);
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("start_sign_in", expect.anything()),
    );

    await cancelSignIn();

    expect(invokeMock).toHaveBeenCalledWith("cancel_sign_in", undefined);
    const error = await outcome;
    expect(isSignInCancelledError(error)).toBe(true);
  });

  it("surfaces an invalid URL error from start_sign_in", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "start_sign_in") throw "Web URL must use https (or http for localhost/127.0.0.1)";
      return undefined;
    });
    await expect(startSignIn("http://evil.example")).rejects.toThrow("Web URL must use https");
  });
});
