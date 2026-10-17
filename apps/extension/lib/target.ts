import { sendNativeMessage } from "./native-messaging";
import { DEFAULT_DESKTOP_HTTP, localServerFetch } from "./local-server";
import { getSettings, onSettingsChanged, type ExtensionSettings } from "./settings";

export { DEFAULT_DESKTOP_HTTP };
export const TARGET_CACHE_TTL_MS = 30_000;

export interface DesktopSessionSignedIn {
  signedIn: true;
  webUrl: string;
  token: string;
  email?: string;
}

export interface DesktopSessionSignedOut {
  signedIn: false;
}

export type DesktopSession = DesktopSessionSignedIn | DesktopSessionSignedOut;

export type ResolvedTarget =
  | {
      type: "desktop-web";
      displayLabel: string;
      webUrl: string;
      token: string;
      email?: string;
    }
  | {
      type: "desktop-offline";
      displayLabel: string;
      transport: "native" | "http";
    }
  | {
      type: "web";
      displayLabel: string;
      webUrl: string;
      token: string;
    }
  | {
      type: "error";
      displayLabel: string;
      error: string;
    }
  | {
      type: "unconfigured";
      displayLabel: string;
      reason: "desktop_not_reachable" | "web_not_configured" | "no_target";
    };

/**
 * Parses the response from get_session (HTTP or Native).
 * Tolerates both { data: { ... } } envelopes and bare { ... } objects.
 */
export function parseSessionResponse(raw: unknown): DesktopSession | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  let obj = raw as Record<string, any>;
  if ("data" in obj && obj.data && typeof obj.data === "object") {
    obj = obj.data;
  }

  if (typeof obj.signedIn !== "boolean") {
    return null;
  }

  if (obj.signedIn) {
    if (
      typeof obj.webUrl !== "string" ||
      !obj.webUrl.trim() ||
      typeof obj.token !== "string" ||
      !obj.token.trim()
    ) {
      return null;
    }
    return {
      signedIn: true,
      webUrl: obj.webUrl.trim().replace(/\/+$/, ""),
      token: obj.token.trim(),
      email: typeof obj.email === "string" && obj.email.trim() ? obj.email.trim() : undefined,
    };
  }

  return {
    signedIn: false,
  };
}

export function formatWebHostLabel(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    return `Saving to ${parsed.host}`;
  } catch {
    return `Saving to ${urlStr}`;
  }
}

// In-memory cache for resolved target
let cachedTarget: { target: ResolvedTarget; timestamp: number } | null = null;

export function getCachedTarget(): ResolvedTarget | null {
  if (cachedTarget && Date.now() - cachedTarget.timestamp < TARGET_CACHE_TTL_MS) {
    return cachedTarget.target;
  }
  return null;
}

export function setCachedTarget(target: ResolvedTarget): void {
  cachedTarget = { target, timestamp: Date.now() };
}

export function invalidateTargetCache(): void {
  cachedTarget = null;
}

// Invalidate cache if extension settings change
onSettingsChanged(() => {
  invalidateTargetCache();
});

export interface TargetResolverDeps {
  queryDesktopNative?: () => Promise<DesktopSession | unknown>;
  queryDesktopHttp?: () => Promise<DesktopSession | unknown>;
  pingDesktopNative?: () => Promise<boolean>;
  pingDesktopHttp?: () => Promise<boolean>;
}

/**
 * Queries desktop app session via native messaging.
 */
async function queryDesktopNativeSession(timeoutMs = 1500): Promise<DesktopSession | null> {
  try {
    const res = await sendNativeMessage<unknown>({ type: "get_session" }, timeoutMs);
    return parseSessionResponse(res);
  } catch {
    return null;
  }
}

/**
 * Queries desktop app session via local HTTP server.
 */
async function queryDesktopHttpSession(timeoutMs = 1500): Promise<DesktopSession | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await localServerFetch("/api/session", {
      method: "GET",
      mode: "cors",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      return null;
    }
    const json = await res.json();
    return parseSessionResponse(json);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks if desktop app is reachable via native messaging ping.
 */
async function pingDesktopNative(timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await sendNativeMessage<any>({ type: "ping" }, timeoutMs);
    return Boolean(res && (res.status === "ok" || res.app === "sourcefold"));
  } catch {
    return false;
  }
}

/**
 * Checks if desktop app is reachable via local HTTP health check.
 */
async function pingDesktopHttp(timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await localServerFetch("/api/health", {
      method: "GET",
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** The first channel that returns a readable session, or null once every channel has failed. */
function firstSession(
  channels: { via: "native" | "http"; query: () => Promise<unknown> }[],
): Promise<{ session: DesktopSession; via: "native" | "http" } | null> {
  return new Promise((resolve) => {
    let pending = channels.length;
    for (const { via, query } of channels) {
      Promise.resolve()
        .then(query)
        .then(parseSessionResponse, () => null)
        .then((session) => {
          if (session) resolve({ session, via });
          else if (--pending === 0) resolve(null);
        });
    }
  });
}

export interface ResolveTargetOptions {
  forceRefresh?: boolean;
  settings?: ExtensionSettings;
  deps?: TargetResolverDeps;
}

/**
 * Resolves the active saving target according to the configured mode.
 *
 * In auto mode:
 * 1. Ask desktop app for session over native messaging and HTTP GET /api/session at once.
 * 2. If desktop signed in -> save to web API at session.webUrl with session.token.
 * 3. If desktop reachable but explicitly not signed in -> save to desktop offline library (native messaging else local HTTP).
 * 4. If desktop is reachable (health OK) but session couldn't be read -> resolve to an error target (do NOT cache).
 * 5. If desktop not reachable -> use configured web app (appUrl + token).
 *    If not configured -> return unconfigured state.
 *
 * In desktop mode:
 * Only save to desktop (session or offline). Desktop unreachable -> unconfigured.
 *
 * In web mode:
 * Only save to configured web app. Not configured -> unconfigured.
 */
export async function resolveTarget(options: ResolveTargetOptions = {}): Promise<ResolvedTarget> {
  if (!options.forceRefresh) {
    const cached = getCachedTarget();
    if (cached) {
      return cached;
    }
  }

  const settings = options.settings || (await getSettings());
  const mode = settings.connectionMode || "auto";

  const nativeQuery = options.deps?.queryDesktopNative || queryDesktopNativeSession;
  const httpQuery = options.deps?.queryDesktopHttp || queryDesktopHttpSession;
  const nativePing = options.deps?.pingDesktopNative || pingDesktopNative;
  const httpPing = options.deps?.pingDesktopHttp || pingDesktopHttp;

  // Web app only mode: never query desktop
  if (mode === "web") {
    const webUrl = settings.appUrl ? settings.appUrl.trim().replace(/\/+$/, "") : "";
    const token = settings.token ? settings.token.trim() : "";
    if (webUrl && token) {
      const target: ResolvedTarget = {
        type: "web",
        displayLabel: formatWebHostLabel(webUrl),
        webUrl,
        token,
      };
      setCachedTarget(target);
      return target;
    }
    const target: ResolvedTarget = {
      type: "unconfigured",
      displayLabel: "Open the Sourcefold desktop app or set up the web app in Options",
      reason: "web_not_configured",
    };
    setCachedTarget(target);
    return target;
  }

  // Desktop or Auto mode: ask the desktop app over both channels at once. Native messaging
  // starts a new host process for every message, so the local server (when the app is running)
  // usually answers first and is the faster channel for later offline calls too.
  const answer = await firstSession([
    { via: "native", query: nativeQuery },
    { via: "http", query: httpQuery },
  ]);
  const desktopSession: DesktopSession | null = answer?.session ?? null;
  let transport: "native" | "http" = answer?.via ?? "native";

  // If a valid session response was returned by desktop
  if (desktopSession !== null) {
    if (desktopSession.signedIn) {
      // Step 2: Desktop signed in -> save to web API
      const target: ResolvedTarget = {
        type: "desktop-web",
        displayLabel: "Saving to your account (via desktop app)",
        webUrl: desktopSession.webUrl,
        token: desktopSession.token,
        email: desktopSession.email,
      };
      setCachedTarget(target);
      return target;
    } else {
      // Step 3: Desktop reachable and explicitly signedIn: false -> offline library
      const target: ResolvedTarget = {
        type: "desktop-offline",
        displayLabel: "Saving to this computer (desktop app, offline)",
        transport,
      };
      setCachedTarget(target);
      return target;
    }
  }

  // If session couldn't be read (403, network error, timeout, bad JSON), check if desktop is reachable via ping/health
  const [nativeUp, httpUp] = await Promise.all([
    nativePing().catch(() => false),
    httpPing().catch(() => false),
  ]);
  const desktopReachable = nativeUp || httpUp;
  transport = nativeUp ? "native" : "http";

  // If desktop is reachable but session couldn't be read -> resolve to error target and DO NOT cache
  if (desktopReachable) {
    const errorMsg = "Can't read the desktop app's sign-in. Open Options to fix it.";
    return {
      type: "error",
      displayLabel: errorMsg,
      error: errorMsg,
    };
  }

  // Desktop is NOT reachable
  if (mode === "desktop") {
    const target: ResolvedTarget = {
      type: "unconfigured",
      displayLabel: "Open the Sourcefold desktop app or set up the web app in Options",
      reason: "desktop_not_reachable",
    };
    setCachedTarget(target);
    return target;
  }

  // In auto mode, fallback to configured web app
  const webUrl = settings.appUrl ? settings.appUrl.trim().replace(/\/+$/, "") : "";
  const token = settings.token ? settings.token.trim() : "";
  if (webUrl && token) {
    const target: ResolvedTarget = {
      type: "web",
      displayLabel: formatWebHostLabel(webUrl),
      webUrl,
      token,
    };
    setCachedTarget(target);
    return target;
  }

  const target: ResolvedTarget = {
    type: "unconfigured",
    displayLabel: "Open the Sourcefold desktop app or set up the web app in Options",
    reason: "no_target",
  };
  setCachedTarget(target);
  return target;
}
