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
  /** `settings`: the token pasted in Claude Desktop. `desktop`: the desktop app's sign-in. */
  source: "settings" | "desktop";
  email: string | null;
}

export const NOT_SIGNED_IN_MESSAGE =
  "Sourcefold isn't signed in on this computer. Sign in to the Sourcefold desktop app, or create an access token on the website (Settings → Create token) and paste it in Claude Desktop → Settings → Extensions → Sourcefold.";

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

interface DesktopSession {
  web_url?: string;
  token?: string;
  email?: string | null;
}

export function loadCredentials(env: NodeJS.ProcessEnv = process.env): Credentials | null {
  const session = readJsonFile<DesktopSession>(join(appDataDir(env), "session.json"));
  const token = setting(env.SOURCEFOLD_TOKEN);
  if (token) {
    const webUrl = setting(env.SOURCEFOLD_WEB_URL) ?? setting(session?.web_url) ?? DEFAULT_WEB_URL;
    if (webUrl) return { webUrl: trimSlash(webUrl), token, source: "settings", email: null };
  }
  if (session?.token && session.web_url) {
    return {
      webUrl: trimSlash(session.web_url),
      token: session.token,
      source: "desktop",
      email: session.email ?? null,
    };
  }
  return null;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
