import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Where the server finds a sign-in (docs/dev/handoff-mcp.md, "Credentials"). Read fresh on every
// call, so signing in to the desktop app later works without restarting Claude.

declare const __SOURCEFOLD_DEFAULT_WEB_URL__: string | undefined;

/** The web address baked in by the build (repository variable `SOURCEFOLD_WEB_URL`). */
export const DEFAULT_WEB_URL: string =
  typeof __SOURCEFOLD_DEFAULT_WEB_URL__ === "string" ? __SOURCEFOLD_DEFAULT_WEB_URL__ : "";

export interface Credentials {
  webUrl: string;
  token: string;
  /** `settings`: the token pasted in Claude Desktop. `desktop`: the desktop app's sign-in. `web`: the web connector. */
  source: "settings" | "desktop" | "web";
  email: string | null;
  /** Unix seconds when the token stops working; only the desktop app's sign-in has one. */
  expiresAt?: number | null;
  /**
   * Set for the desktop app's Supabase sign-in (since 2026-10-23): the server then runs the
   * website's API itself against Supabase (`@sourcefold/client`), so no website is needed.
   */
  supabase?: { url: string; publishableKey: string; userId: string; contentUrl?: string };
}

export const NOT_SIGNED_IN_MESSAGE =
  "Sourcefold isn't signed in on this computer. Sign in to the Sourcefold desktop app, or create an access token on the website (Settings → Create token) and paste it in Claude Desktop → Settings → Extensions → Sourcefold.";

export const DESKTOP_SIGN_IN_EXPIRED_MESSAGE =
  "The desktop app's sign-in on this computer has expired: it lasts about an hour, and only the running app renews it. Open the Sourcefold desktop app once (it renews the sign-in within a few seconds), or create an access token on the website (Settings → Create token) and paste it in Claude Desktop → Settings → Extensions → Sourcefold, which keeps working while the app is closed.";

/** Seconds of margin, so a token isn't used moments before it runs out. */
const EXPIRY_MARGIN_S = 30;

/** True when a desktop sign-in has run out (or is about to). */
export function isExpired(creds: Credentials, nowMs = Date.now()): boolean {
  return typeof creds.expiresAt === "number" && creds.expiresAt - EXPIRY_MARGIN_S <= nowMs / 1000;
}

/** The desktop app's data folder, the same as Rust's `dirs::data_local_dir()/Sourcefold`. */
export function appDataDir(env: NodeJS.ProcessEnv = process.env, platform = process.platform) {
  if (platform === "win32") {
    return join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Sourcefold");
  }
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Sourcefold");
  }
  return join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "Sourcefold");
}

/** An unfilled bundle setting arrives as an empty string, or as the raw `${user_config.x}`. */
function setting(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith("${")) return null;
  return trimmed;
}

export function readJsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * The desktop app's `session.json` (`apps/desktop/src-tauri/src/session.rs`). Since 2026-10-23 it
 * holds a Supabase access token (`access_token`, `expires_at`, …) and no web address; files from
 * before that hold `web_url` and an `sf_` `token`.
 */
interface DesktopSession {
  supabase_url?: unknown;
  publishable_key?: unknown;
  user_id?: unknown;
  content_url?: unknown;
  access_token?: unknown;
  expires_at?: unknown;
  email?: unknown;
  web_url?: unknown;
  token?: unknown;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? setting(value) : null;
}

/** The Content Worker's address from `content_url`: https, or http on this computer. Anything else is ignored. */
export function contentUrlFrom(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return trimSlash(raw);
  } catch {
    // not a URL
  }
  return undefined;
}

export function loadCredentials(env: NodeJS.ProcessEnv = process.env): Credentials | null {
  const session = readJsonFile<DesktopSession>(join(appDataDir(env), "session.json"));
  const webUrl = setting(env.SOURCEFOLD_WEB_URL) ?? text(session?.web_url) ?? DEFAULT_WEB_URL;
  const email = text(session?.email);

  const pasted = setting(env.SOURCEFOLD_TOKEN);
  if (pasted) {
    return webUrl
      ? { webUrl: trimSlash(webUrl), token: pasted, source: "settings", email: null }
      : null;
  }

  const accessToken = text(session?.access_token);
  const expiresAt = typeof session?.expires_at === "number" ? session.expires_at : null;
  const supabaseUrl = text(session?.supabase_url);
  const publishableKey = text(session?.publishable_key);
  const userId = text(session?.user_id);
  const contentUrl = contentUrlFrom(session?.content_url);
  // The desktop's Supabase sign-in works without any website (QA 2026-11-05: the session file
  // has no web address, so the old path read it as "not signed in" while the app was signed in).
  if (accessToken && supabaseUrl && publishableKey && userId) {
    return {
      webUrl: trimSlash(supabaseUrl),
      token: accessToken,
      source: "desktop",
      email,
      expiresAt,
      supabase: {
        url: trimSlash(supabaseUrl),
        publishableKey,
        userId,
        ...(contentUrl ? { contentUrl } : {}),
      },
    };
  }
  if (accessToken && webUrl) {
    return { webUrl: trimSlash(webUrl), token: accessToken, source: "desktop", email, expiresAt };
  }

  const legacyToken = text(session?.token);
  const legacyUrl = text(session?.web_url);
  if (legacyToken && legacyUrl) {
    return { webUrl: trimSlash(legacyUrl), token: legacyToken, source: "desktop", email };
  }
  return null;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
