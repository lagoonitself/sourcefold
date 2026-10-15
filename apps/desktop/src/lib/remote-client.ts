import type { Session, SessionStatus } from "./types";

export const REMOTE_URL_STORAGE_KEY = "sourcefold:remote_url";
export const PAT_TOKEN_STORAGE_KEY = "sourcefold:pat_token";

export const SESSION_EXPIRED_MESSAGE = "Your sign-in expired. Sign in again.";
export const SIGN_IN_CANCELLED_MESSAGE = "Sign-in cancelled";

export type { Session, SessionStatus };

export interface RemoteConfig {
  remoteApiUrl: string;
  apiToken: string;
}

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
let cachedOfflineMode: boolean = false;
let sessionInitialized: boolean = false;
let sessionInitPromise: Promise<SessionStatus> | null = null;
let sessionExpiryHandling: Promise<void> | null = null;
let sessionExpiredMessage: string | null = null;
let pendingSignIn: { cancel: () => void } | null = null;

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
  if (typeof globalThis !== "undefined" && (globalThis as any).localStorage) {
    return (globalThis as any).localStorage;
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
  return "Authentication failed while saving session.";
}

/** Builds the client-side session object from the shape `get_session` returns. */
export function sessionFromStatus(status: SessionStatus): Session | null {
  if (status.signedIn && status.token && status.webUrl) {
    return {
      web_url: status.webUrl,
      token: status.token,
      email: status.email ?? "",
      signed_in_at: new Date().toISOString(),
    };
  }
  return null;
}

// The Rust side emits `auth-changed` / `auth-error` from the sign-in thread. They are re-published
// as window events once the cached session is up to date, so the UI never races the cache.
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
    webUrl: cachedSession?.web_url,
    email: cachedSession?.email,
    token: cachedSession?.token,
  };
}

/**
 * Loads the current session status from the Tauri backend or fallback localStorage.
 */
export async function getSessionStatus(forceRefresh = false): Promise<SessionStatus> {
  if (sessionInitialized && !forceRefresh) {
    return currentStatus();
  }

  if (sessionInitPromise && !forceRefresh) {
    return sessionInitPromise;
  }

  sessionInitPromise = (async () => {
    try {
      if (isTauri()) {
        const status = await tauriInvoke<SessionStatus>("get_session");
        return applyStatus({
          signedIn: Boolean(status.signedIn),
          offline: Boolean(status.offline),
          webUrl: status.webUrl ?? null,
          email: status.email ?? null,
          token: status.token ?? null,
        });
      }
    } catch (e) {
      console.warn("Failed to load session via Tauri invoke, checking localStorage fallback", e);
    }

    // Fallback for browser dev mode or node test environments
    const storage = getStorage();
    const url = storage?.getItem(REMOTE_URL_STORAGE_KEY) || "";
    const token = storage?.getItem(PAT_TOKEN_STORAGE_KEY) || "";
    return applyStatus({
      signedIn: Boolean(url && token),
      offline: storage?.getItem("sourcefold:offline_mode") === "true",
      webUrl: url || null,
      email: url && token ? "user@sourcefold.app" : null,
      token: token || null,
    });
  })().finally(() => {
    sessionInitPromise = null;
  });

  return sessionInitPromise;
}

export function isRemoteConfigured(): boolean {
  return Boolean(cachedSession && cachedSession.token && cachedSession.web_url);
}

export function getRemoteConfig(): RemoteConfig {
  if (!cachedSession || !cachedSession.token) {
    return {
      remoteApiUrl: "",
      apiToken: "",
    };
  }
  return {
    remoteApiUrl: cachedSession.web_url,
    apiToken: cachedSession.token,
  };
}

export async function testRemoteConnection(
  webUrl: string,
  token: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!webUrl || !webUrl.trim()) {
    return { ok: false, message: "Web App URL is required" };
  }
  if (!token || !token.trim()) {
    return { ok: false, message: "Personal Access Token is required" };
  }
  try {
    const parsed = new URL(webUrl);
    if (!parsed.protocol.startsWith("http")) {
      return { ok: false, message: "Invalid Web App URL format" };
    }
  } catch {
    return { ok: false, message: "Invalid Web App URL format" };
  }
  return { ok: true };
}

export async function setOfflineMode(enabled: boolean): Promise<void> {
  if (isTauri()) {
    await tauriInvoke("set_offline_mode", { offline: enabled });
    await getSessionStatus(true);
    dispatchWindowEvent("sourcefold:auth-changed");
    return;
  }
  const storage = getStorage();
  if (storage) {
    storage.setItem("sourcefold:offline_mode", String(enabled));
  }
  cachedOfflineMode = enabled;
  dispatchWindowEvent("sourcefold:auth-changed");
}

/**
 * Opens the system browser for sign-in and resolves once the Rust side reports the finished
 * session (`auth-changed`). Rejects on `auth-error`, or with "Sign-in cancelled" after
 * `cancelSignIn()`. `start_sign_in` itself returns as soon as the browser has been opened.
 */
export async function startSignIn(webUrl: string): Promise<Session> {
  clearExpiredSessionMessage();

  if (isTauri()) {
    pendingSignIn?.cancel();
    await authListenersReady;

    const outcome = new Promise<Session>((resolve, reject) => {
      const onChanged = () => {
        if (cachedSession) finish(() => resolve(cachedSession as Session));
      };
      const onError = (e: Event) => {
        const message = (e as CustomEvent<{ message?: string }>).detail?.message;
        finish(() => reject(new Error(message || errorMessageFromPayload(null))));
      };
      const handle = {
        cancel: () => finish(() => reject(new Error(SIGN_IN_CANCELLED_MESSAGE))),
      };
      const finish = (settle: () => void) => {
        if (pendingSignIn !== handle) return;
        pendingSignIn = null;
        window.removeEventListener("sourcefold:auth-changed", onChanged);
        window.removeEventListener("sourcefold:auth-error", onError);
        settle();
      };

      pendingSignIn = handle;
      window.addEventListener("sourcefold:auth-changed", onChanged);
      window.addEventListener("sourcefold:auth-error", onError);
    });
    // The attempt may be abandoned (cancel/restart) before anyone awaits it.
    outcome.catch(() => {});

    try {
      await tauriInvoke("start_sign_in", { webUrl });
    } catch (e) {
      pendingSignIn?.cancel();
      throw e instanceof Error ? e : new Error(String(e));
    }
    return outcome;
  }

  // Browser testing fallback simulation
  const dummySession: Session = {
    web_url: webUrl || "http://localhost:3000",
    token: `sf_pat_browser_mock_${Date.now()}`,
    email: "browser_user@sourcefold.app",
    signed_in_at: new Date().toISOString(),
  };
  const storage = getStorage();
  if (storage) {
    storage.setItem(REMOTE_URL_STORAGE_KEY, dummySession.web_url);
    storage.setItem(PAT_TOKEN_STORAGE_KEY, dummySession.token);
  }
  cachedSession = dummySession;
  sessionExpiryHandling = null;
  dispatchWindowEvent("sourcefold:auth-changed");
  return dummySession;
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
  if (isTauri()) {
    await tauriInvoke("sign_out");
    await getSessionStatus(true);
    dispatchWindowEvent("sourcefold:auth-changed");
    return;
  }
  const storage = getStorage();
  if (storage) {
    storage.removeItem(REMOTE_URL_STORAGE_KEY);
    storage.removeItem(PAT_TOKEN_STORAGE_KEY);
  }
  cachedSession = null;
  dispatchWindowEvent("sourcefold:auth-changed");
}

function expireSession(): Promise<void> {
  if (!sessionExpiryHandling) {
    sessionExpiredMessage = SESSION_EXPIRED_MESSAGE;
    sessionExpiryHandling = signOut()
      .catch((e) => {
        console.warn("Sign-out on 401 failed", e);
      })
      .then(() => {
        dispatchWindowEvent("sourcefold:session-expired", { message: SESSION_EXPIRED_MESSAGE });
      });
  }
  return sessionExpiryHandling;
}

export async function remoteFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const config = getRemoteConfig();
  if (!config.apiToken || !config.remoteApiUrl) {
    throw new Error("No active remote session configured.");
  }

  const base = config.remoteApiUrl.replace(/\/+$/, "");
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `${base}${path}`;

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${config.apiToken}`);
  if (!headers.has("Content-Type") && options.body && typeof options.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    if (res.status === 401) {
      // Only clear the session this request was made with; a late 401 for an old token must
      // not sign out a session the user has since replaced.
      if (getRemoteConfig().apiToken === config.apiToken) {
        await expireSession();
      }
      throw new SessionExpiredError();
    }

    const errorBody = await res.json().catch(() => ({}));
    const message =
      errorBody.error?.message ||
      errorBody.message ||
      errorBody.error ||
      `Remote API request failed with status ${res.status}`;
    throw new Error(message);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const data = await res.json().catch(() => ({}));
  return (data.data !== undefined ? data.data : data) as T;
}
