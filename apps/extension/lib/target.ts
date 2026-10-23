import { sendNativeMessage } from "./native-messaging";
import { DEFAULT_DESKTOP_HTTP, localServerFetch } from "./local-server";
import { getSettings, onSettingsChanged, type ExtensionSettings } from "./settings";

export { DEFAULT_DESKTOP_HTTP };
export const TARGET_CACHE_TTL_MS = 30_000;
/** A borrowed token this close to expiry isn't used; the desktop app refreshes it first. */
export const BORROWED_TOKEN_MARGIN_MS = 60_000;

/** What the desktop app's `/api/session` and native host's `get_session` answer when signed in. */
export interface DesktopSessionSignedIn {
  signedIn: true;
  supabaseUrl: string;
  supabasePublishableKey: string;
  accessToken: string;
  /** Unix seconds. */
  expiresAt: number;
  userId: string;
  email?: string;
}

export interface DesktopSessionSignedOut {
  signedIn: false;
}

export type DesktopSession = DesktopSessionSignedIn | DesktopSessionSignedOut;

/** The extension's own Google sign-in, when it has one. */
export interface OwnAccount {
  userId: string;
  email?: string;
}

// Targets cross from the background to the popup, so none of them holds a token.
export type ResolvedTarget =
  | {
      /** Saves go to the account in Supabase, through the local API in the background. */
      type: "account";
      via: "extension" | "desktop";
      displayLabel: string;
      email?: string;
    }
  | {
      type: "desktop-offline";
      displayLabel: string;
      transport: "native" | "http";
    }
  | {
      type: "error";
      displayLabel: string;
      error: string;
    }
  | {
      /** Nothing to save to yet: sign in with Google, or open the desktop app. */
      type: "signed-out";
      displayLabel: string;
      reason: "signed_out" | "desktop_not_reachable";
    };

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Parses the response from get_session (HTTP or Native).
 * Tolerates both { data: { ... } } envelopes and bare { ... } objects.
 * Desktop apps before 0.4 answered `{ webUrl, token }`; that reads as unreadable (null).
 */
export function parseSessionResponse(raw: unknown): DesktopSession | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  let obj = raw as Record<string, unknown>;
  if ("data" in obj && obj.data && typeof obj.data === "object") {
    obj = obj.data as Record<string, unknown>;
  }

  if (typeof obj.signedIn !== "boolean") {
    return null;
  }

  if (!obj.signedIn) {
    return { signedIn: false };
  }

  const supabaseUrl = nonEmpty(obj.supabaseUrl);
  const supabasePublishableKey = nonEmpty(obj.supabasePublishableKey);
  const accessToken = nonEmpty(obj.accessToken);
  const userId = nonEmpty(obj.userId);
  const expiresAt = typeof obj.expiresAt === "number" ? obj.expiresAt : NaN;
  if (!supabaseUrl || !supabasePublishableKey || !accessToken || !userId || !isFinite(expiresAt)) {
    return null;
  }
  return {
    signedIn: true,
    supabaseUrl: supabaseUrl.replace(/\/+$/, ""),
    supabasePublishableKey,
    accessToken,
    expiresAt,
    userId,
    email: nonEmpty(obj.email) ?? undefined,
  };
}

/** Whether a borrowed token still has time left. */
export function isBorrowable(session: DesktopSessionSignedIn, now: number = Date.now()): boolean {
  return session.expiresAt * 1000 - now > BORROWED_TOKEN_MARGIN_MS;
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
  /** The extension's own sign-in (background only). */
  getOwnAccount?: () => Promise<OwnAccount | null>;
  /** Hands a usable desktop sign-in to whoever saves with it (background only). */
  onDesktopSession?: (session: DesktopSessionSignedIn) => void;
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
    const res = await sendNativeMessage<{ status?: string; app?: string }>(
      { type: "ping" },
      timeoutMs,
    );
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

type Channel = { via: "native" | "http"; query: () => Promise<unknown> };

/**
 * Asks both channels at once. A usable sign-in wins at once; otherwise the best answer once both
 * have replied (signed out beats an expired sign-in, which beats nothing). The native host reads
 * the desktop's session file even while the app is closed, so its token can be stale while the
 * local server (app running) has a fresh one.
 */
function bestSession(
  channels: Channel[],
  now: number,
): Promise<{ session: DesktopSession; via: "native" | "http" } | null> {
  return new Promise((resolve) => {
    let pending = channels.length;
    let signedOut: { session: DesktopSession; via: "native" | "http" } | null = null;
    let stale: { session: DesktopSession; via: "native" | "http" } | null = null;
    for (const { via, query } of channels) {
      Promise.resolve()
        .then(query)
        .then(parseSessionResponse, () => null)
        .then((session) => {
          if (session?.signedIn && isBorrowable(session, now)) {
            resolve({ session, via });
            return;
          }
          if (session && !session.signedIn) signedOut ??= { session, via };
          else if (session) stale ??= { session, via };
          if (--pending === 0) resolve(signedOut ?? stale);
        });
    }
  });
}

export interface ResolveTargetOptions {
  forceRefresh?: boolean;
  settings?: ExtensionSettings;
  deps?: TargetResolverDeps;
}

const SIGNED_OUT_LABEL = "Sign in with Google to save to your account, or open the desktop app.";
const DESKTOP_ONLY_LABEL = "Open the Sourcefold desktop app to save from here.";
const OLD_DESKTOP_LABEL =
  "This desktop app is too old to share its sign-in. Update it, or sign in with Google here.";
const STALE_DESKTOP_LABEL = "The desktop app's sign-in has expired. Open the app, or sign in here.";

/**
 * Resolves where saves go. Runs in the background, which owns the sign-ins.
 *
 * Auto mode:
 * 1. The extension is signed in itself → the account (it refreshes its own session).
 * 2. Otherwise ask the desktop app (native messaging and GET /api/session at once):
 *    signed out → its offline library; signed in → the account, with the desktop's token.
 * 3. The desktop app answers but its sign-in can't be used (an old version, an expired token)
 *    → an error target (not cached).
 * 4. Nothing → signed out: sign in with Google, or open the desktop app.
 *
 * Desktop mode: only the desktop app (offline library or its sign-in); the extension's own
 * sign-in isn't used.
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
  const deps = options.deps ?? {};

  const done = (target: ResolvedTarget, cache = true): ResolvedTarget => {
    if (cache) setCachedTarget(target);
    return target;
  };

  if (mode === "auto") {
    const own = await (deps.getOwnAccount?.() ?? Promise.resolve(null)).catch(() => null);
    if (own) {
      return done({
        type: "account",
        via: "extension",
        displayLabel: own.email ? `Saving to your account (${own.email})` : "Saving to your account",
        email: own.email,
      });
    }
  }

  const nativeQuery = deps.queryDesktopNative || queryDesktopNativeSession;
  const httpQuery = deps.queryDesktopHttp || queryDesktopHttpSession;
  const now = Date.now();

  // Native messaging starts a new host process for every message, so the local server (when the
  // app is running) usually answers first and is the faster channel for later offline calls too.
  const answer = await bestSession(
    [
      { via: "native", query: nativeQuery },
      { via: "http", query: httpQuery },
    ],
    now,
  );

  if (answer) {
    const { session, via } = answer;
    if (!session.signedIn) {
      return done({
        type: "desktop-offline",
        displayLabel: "Saving to this computer (desktop app, offline)",
        transport: via,
      });
    }
    if (isBorrowable(session, now)) {
      deps.onDesktopSession?.(session);
      return done({
        type: "account",
        via: "desktop",
        displayLabel: session.email
          ? `Saving to your account (${session.email}, desktop app's sign-in)`
          : "Saving to your account (desktop app's sign-in)",
        email: session.email,
      });
    }
    return done({ type: "error", displayLabel: STALE_DESKTOP_LABEL, error: STALE_DESKTOP_LABEL }, false);
  }

  // The session couldn't be read (an old app, 403, timeout, bad JSON): is the app there at all?
  const nativePing = deps.pingDesktopNative || pingDesktopNative;
  const httpPing = deps.pingDesktopHttp || pingDesktopHttp;
  const [nativeUp, httpUp] = await Promise.all([
    nativePing().catch(() => false),
    httpPing().catch(() => false),
  ]);
  if (nativeUp || httpUp) {
    return done({ type: "error", displayLabel: OLD_DESKTOP_LABEL, error: OLD_DESKTOP_LABEL }, false);
  }

  if (mode === "desktop") {
    return done({
      type: "signed-out",
      displayLabel: DESKTOP_ONLY_LABEL,
      reason: "desktop_not_reachable",
    });
  }
  return done({ type: "signed-out", displayLabel: SIGNED_OUT_LABEL, reason: "signed_out" });
}
