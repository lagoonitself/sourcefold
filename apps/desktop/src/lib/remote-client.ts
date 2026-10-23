import { OAUTH_QUERY_PARAMS, OAUTH_SCOPES } from "@sourcefold/client";
import type { Session as SupabaseSession } from "@supabase/supabase-js";
import type { Session, SessionStatus } from "./types";
import { closeLocalApi, getLocalApi, startLocalApiBridge } from "./local-api";
import { getSupabase, getSupabaseConfig, isSupabaseConfigured } from "./supabase";
import { openUrl } from "./utils";

// Signed in, the desktop app talks to the account (Supabase) and Google Drive itself; the website
// is optional (docs/dev/handoff-no-website.md). Sign-in is Google through Supabase in the system
// browser, coming back to a listener Rust opens on 127.0.0.1 (`start_sign_in`). The Supabase
// session lives here, in the webview; Rust gets the current access token (`session_set`) for the
// extension and Claude. "Remote" calls are the website's API run in this webview (`local-api.ts`).

export const SESSION_EXPIRED_MESSAGE = "Your sign-in expired. Sign in again.";
export const SIGN_IN_CANCELLED_MESSAGE = "Sign-in cancelled";
const OFFLINE_STORAGE_KEY = "sourcefold:offline_mode";

export type { Session, SessionStatus };

export class SessionExpiredError extends Error {
  constructor() {
    super(SESSION_EXPIRED_MESSAGE);
    this.name = "SessionExpiredError";
  }
}

export function isSessionExpiredError(err: unknown): boolean {
  return err instanceof SessionExpiredError;
}

export function isSignInCancelledError(err: unknown): boolean {
  return err instanceof Error && err.message === SIGN_IN_CANCELLED_MESSAGE;
}

let cachedSession: Session | null = null;
let cachedOfflineMode = false;
let sessionInitialized = false;
let sessionInitPromise: Promise<SessionStatus> | null = null;
let sessionExpiryHandling: Promise<void> | null = null;
let sessionExpiredMessage: string | null = null;
let pendingSignIn: { cancel: () => void } | null = null;
let signingOut = false;

export function getExpiredSessionMessage(): string | null {
  return sessionExpiredMessage;
}

export function clearExpiredSessionMessage(): void {
  sessionExpiredMessage = null;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
}

function getStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

function dispatchWindowEvent(eventName: string, detail?: unknown): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    if (detail !== undefined) {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    } else {
      window.dispatchEvent(new Event(eventName));
    }
  }
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function errorMessageFromPayload(payload: unknown): string {
  if (typeof payload === "string" && payload) return payload;
  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof (payload as { message: unknown }).message === "string"
  ) {
    return (payload as { message: string }).message;
  }
  return "Sign-in failed. Try again.";
}

/** Builds the client-side session object from a session status. */
export function sessionFromStatus(status: SessionStatus): Session | null {
  if (status.signedIn && status.userId) {
    return {
      user_id: status.userId,
      email: status.email ?? "",
      signed_in_at:
        cachedSession?.user_id === status.userId
          ? cachedSession.signed_in_at
          : new Date().toISOString(),
    };
  }
  return null;
}

/** Tells Rust the current access token, for the extension and Claude (never the refresh token). */
async function reportSession(session: SupabaseSession): Promise<void> {
  if (!isTauri()) return;
  const config = getSupabaseConfig();
  const expiresAt =
    session.expires_at ?? Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600);
  const reported = {
    supabaseUrl: config.supabaseUrl,
    publishableKey: config.supabasePublishableKey,
    accessToken: session.access_token,
    expiresAt,
    userId: session.user.id,
    email: session.user.email ?? null,
  };
  try {
    await tauriInvoke("session_set", { session: reported });
  } catch (err) {
    console.warn("Couldn't hand the sign-in to the rest of the app", err);
  }
}

// Rust emits `oauth-callback` (the code from the browser) and `auth-error` from the sign-in
// listener, and `auth-changed` after sign-out or a mode change. They are re-published as window
// events once the cached session is up to date, so the UI never races the cache.
let authListenersReady: Promise<void> = Promise.resolve();
if (typeof window !== "undefined" && isTauri()) {
  authListenersReady = import("@tauri-apps/api/event")
    .then(async ({ listen }) => {
      await listen("auth-changed", () => {
        void getSessionStatus(true).then(() => {
          dispatchWindowEvent("sourcefold:refresh");
          dispatchWindowEvent("sourcefold:auth-changed");
        });
      });

      await listen("oauth-callback", (event: { payload: unknown }) => {
        const code = (event.payload as { code?: unknown } | null)?.code;
        if (typeof code === "string" && code) {
          dispatchWindowEvent("sourcefold:oauth-callback", { code });
        }
      });

      await listen("auth-error", (event: { payload: unknown }) => {
        dispatchWindowEvent("sourcefold:auth-error", {
          message: errorMessageFromPayload(event.payload),
        });
      });
    })
    .catch((err) => {
      console.warn("Failed to set up Tauri auth listeners", err);
    });
}

let supabaseWatched: ReturnType<typeof getSupabase> | null = null;

/** Keeps Rust's copy of the access token current, and notices when Supabase ends the session. */
function watchSupabase(): void {
  if (!isSupabaseConfigured()) return;
  const supabase = getSupabase();
  if (supabaseWatched === supabase) return;
  supabaseWatched = supabase;
  supabase.auth.onAuthStateChange((event, session) => {
    if (
      session &&
      (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION")
    ) {
      void reportSession(session);
    } else if (event === "SIGNED_OUT" && cachedSession && !signingOut) {
      // The refresh token was revoked or expired.
      void expireSession();
    }
  });
}

function applyStatus(status: SessionStatus): SessionStatus {
  cachedSession = sessionFromStatus(status);
  cachedOfflineMode = status.offline;
  if (cachedSession) {
    sessionExpiryHandling = null;
  }
  sessionInitialized = true;
  return status;
}

function currentStatus(): SessionStatus {
  return {
    signedIn: Boolean(cachedSession),
    offline: cachedOfflineMode,
    email: cachedSession?.email ?? null,
    userId: cachedSession?.user_id ?? null,
  };
}

async function readOffline(): Promise<boolean> {
  if (isTauri()) {
    try {
      const status = await tauriInvoke<{ offline?: boolean }>("get_session");
      return Boolean(status?.offline);
    } catch (e) {
      console.warn("Failed to read offline mode", e);
      return false;
    }
  }
  return getStorage()?.getItem(OFFLINE_STORAGE_KEY) === "true";
}

/** The current account and mode. Signed in wins over offline, as before. */
export async function getSessionStatus(forceRefresh = false): Promise<SessionStatus> {
  if (sessionInitialized && !forceRefresh) {
    return currentStatus();
  }
  if (sessionInitPromise && !forceRefresh) {
    return sessionInitPromise;
  }

  sessionInitPromise = (async () => {
    let session: SupabaseSession | null = null;
    if (isSupabaseConfigured()) {
      try {
        watchSupabase();
        const { data } = await getSupabase().auth.getSession();
        session = data.session;
      } catch (e) {
        console.warn("Failed to read the sign-in", e);
      }
    }
    if (session) {
      void startLocalApiBridge();
      return applyStatus({
        signedIn: true,
        offline: false,
        email: session.user.email ?? null,
        userId: session.user.id,
      });
    }
    return applyStatus({
      signedIn: false,
      offline: await readOffline(),
      email: null,
      userId: null,
    });
  })().finally(() => {
    sessionInitPromise = null;
  });

  return sessionInitPromise;
}

export function isRemoteConfigured(): boolean {
  return Boolean(cachedSession);
}

export async function setOfflineMode(enabled: boolean): Promise<void> {
  if (isTauri()) {
    await tauriInvoke("set_offline_mode", { offline: enabled });
    await getSessionStatus(true);
    dispatchWindowEvent("sourcefold:auth-changed");
    return;
  }
  getStorage()?.setItem(OFFLINE_STORAGE_KEY, String(enabled));
  cachedOfflineMode = enabled;
  dispatchWindowEvent("sourcefold:auth-changed");
}

/** Waits for the code from the browser, or an error, or `cancelSignIn()`. */
function waitForCallback(): { promise: Promise<string>; handle: { cancel: () => void } } {
  let handle!: { cancel: () => void };
  const promise = new Promise<string>((resolve, reject) => {
    const onCode = (e: Event) => {
      const code = (e as CustomEvent<{ code?: string }>).detail?.code;
      if (code) finish(() => resolve(code));
    };
    const onError = (e: Event) => {
      const message = (e as CustomEvent<{ message?: string }>).detail?.message;
      finish(() => reject(new Error(message || errorMessageFromPayload(null))));
    };
    handle = { cancel: () => finish(() => reject(new Error(SIGN_IN_CANCELLED_MESSAGE))) };
    const finish = (settle: () => void) => {
      if (pendingSignIn !== handle) return;
      pendingSignIn = null;
      window.removeEventListener("sourcefold:oauth-callback", onCode);
      window.removeEventListener("sourcefold:auth-error", onError);
      settle();
    };
    window.addEventListener("sourcefold:oauth-callback", onCode);
    window.addEventListener("sourcefold:auth-error", onError);
  });
  // The attempt may be abandoned (cancel/restart) before anyone awaits it.
  promise.catch(() => {});
  return { promise, handle };
}

/**
 * Signs in with Google through Supabase in the system browser. Resolves with the session once the
 * browser comes back and the code is exchanged; rejects on an error from the browser, or with
 * "Sign-in cancelled" after `cancelSignIn()`.
 */
export async function startSignIn(): Promise<Session> {
  clearExpiredSessionMessage();
  if (!isTauri()) {
    throw new Error("Sign-in needs the Sourcefold desktop app.");
  }
  if (!isSupabaseConfigured()) {
    throw new Error("This copy of Sourcefold has no account server set. Add it under Advanced.");
  }

  pendingSignIn?.cancel();
  await authListenersReady;
  const { promise, handle } = waitForCallback();
  pendingSignIn = handle;

  try {
    const port = await tauriInvoke<number>("start_sign_in");
    const supabase = getSupabase();
    watchSupabase();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `http://127.0.0.1:${port}/callback`,
        skipBrowserRedirect: true,
        scopes: OAUTH_SCOPES,
        queryParams: { ...OAUTH_QUERY_PARAMS },
      },
    });
    if (error || !data?.url) throw new Error(error?.message || "Couldn't start the sign-in.");
    await openUrl(data.url);
  } catch (e) {
    handle.cancel();
    throw e instanceof Error ? e : new Error(String(e));
  }

  const code = await promise;
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    throw new Error(error?.message || "The sign-in didn't finish. Try again.");
  }
  const session = data.session;

  // Drive needs Google's refresh token on the account, as the website's /auth/callback saves it.
  if (session.provider_refresh_token) {
    const { error: rpcError } = await supabase.rpc("save_google_refresh_token", {
      p_refresh_token: session.provider_refresh_token,
    });
    if (rpcError) console.error("Failed to save the Google refresh token", rpcError);
  }

  await reportSession(session);
  await tauriInvoke("set_offline_mode", { offline: false });
  void startLocalApiBridge();
  applyStatus({
    signedIn: true,
    offline: false,
    email: session.user.email ?? null,
    userId: session.user.id,
  });
  dispatchWindowEvent("sourcefold:auth-changed");
  dispatchWindowEvent("sourcefold:refresh");
  return cachedSession as Session;
}

export async function cancelSignIn(): Promise<void> {
  pendingSignIn?.cancel();
  if (isTauri()) {
    try {
      await tauriInvoke("cancel_sign_in");
    } catch (e) {
      console.warn("Cancel sign-in failed", e);
    }
  }
}

export async function signOut(): Promise<void> {
  signingOut = true;
  try {
    // Changes waiting for the automatic Drive push go first.
    await closeLocalApi({ flush: Boolean(cachedSession) });
    if (isSupabaseConfigured()) {
      // This computer only; the website and other devices stay signed in.
      await getSupabase()
        .auth.signOut({ scope: "local" })
        .catch((e) => console.warn("Supabase sign-out failed", e));
    }
    cachedSession = null;
    if (isTauri()) {
      await tauriInvoke("sign_out");
      await getSessionStatus(true);
    }
    dispatchWindowEvent("sourcefold:auth-changed");
  } finally {
    signingOut = false;
  }
}

function expireSession(): Promise<void> {
  if (!sessionExpiryHandling) {
    sessionExpiredMessage = SESSION_EXPIRED_MESSAGE;
    sessionExpiryHandling = signOut()
      .catch((e) => {
        console.warn("Sign-out on an expired session failed", e);
      })
      .then(() => {
        dispatchWindowEvent("sourcefold:session-expired", { message: SESSION_EXPIRED_MESSAGE });
      });
  }
  return sessionExpiryHandling;
}

/**
 * The website's API, answered in this webview. A 401 means the sign-in is gone only when Supabase
 * has no session any more; Drive's own 401 ("Reconnect Google Drive…") is passed on as an error.
 */
export async function localApiFetch(
  endpoint: string,
  options: RequestInit = {},
): Promise<Response> {
  if (!cachedSession) {
    throw new Error("No active remote session configured.");
  }
  const userId = cachedSession.user_id;
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body && typeof options.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  const res = await getLocalApi().fetch(path, { ...options, headers });
  if (res.status === 401) {
    const { data } = await getSupabase().auth.getSession();
    if (!data.session) {
      // Only end the session this request was made with, never one signed in since.
      if (cachedSession?.user_id === userId) await expireSession();
      throw new SessionExpiredError();
    }
  }
  return res;
}

export async function remoteFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const res = await localApiFetch(endpoint, options);

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message =
      errorBody.error?.message ||
      errorBody.message ||
      errorBody.error ||
      `Request failed with status ${res.status}`;
    throw new Error(message);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const data = await res.json().catch(() => ({}));
  return (data.data !== undefined ? data.data : data) as T;
}
