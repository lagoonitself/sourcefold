import { browser } from "wxt/browser";

export type ConnectionMode = "auto" | "desktop" | "web";
export type LegacyConnectionMode = "native" | "http";
export type AnyConnectionMode = ConnectionMode | LegacyConnectionMode;

export interface ExtensionSettings {
  appUrl: string;
  token: string;
  connectionMode?: ConnectionMode;
}

export const DEFAULT_SETTINGS: Required<ExtensionSettings> = {
  appUrl: "http://localhost:3000",
  token: "",
  connectionMode: "auto",
};

export function normalizeConnectionMode(mode: unknown): ConnectionMode {
  if (mode === "desktop" || mode === "native" || mode === "http") {
    return "desktop";
  }
  if (mode === "web") {
    return "web";
  }
  return "auto";
}

export function isLocalUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

export function isTokenRequired(settings: ExtensionSettings): boolean {
  const mode = normalizeConnectionMode(settings.connectionMode);
  if (mode === "desktop") {
    return false;
  }
  if (mode === "auto") {
    // In auto mode, desktop handles its own auth or session token.
    // If desktop is unreachable and fallback to web is needed, token might be needed,
    // but popup should attempt resolution before forcing user to enter a token.
    return false;
  }
  if (isLocalUrl(settings.appUrl)) {
    return false;
  }
  return true;
}

// Invalidation listeners can be registered (e.g. Target Resolver cache)
type SettingsChangeListener = (settings: Required<ExtensionSettings>) => void;
const changeListeners: SettingsChangeListener[] = [];

export function onSettingsChanged(listener: SettingsChangeListener): () => void {
  changeListeners.push(listener);
  return () => {
    const idx = changeListeners.indexOf(listener);
    if (idx !== -1) changeListeners.splice(idx, 1);
  };
}

export async function getSettings(): Promise<Required<ExtensionSettings>> {
  const result = await browser.storage.local.get(["appUrl", "token", "connectionMode"]);
  const rawUrl = typeof result.appUrl === "string" ? result.appUrl.trim() : "";
  const appUrl = rawUrl.length > 0 ? rawUrl.replace(/\/+$/, "") : DEFAULT_SETTINGS.appUrl;
  const token = typeof result.token === "string" ? result.token.trim() : DEFAULT_SETTINGS.token;
  const rawMode = result.connectionMode;
  const connectionMode = normalizeConnectionMode(rawMode);

  // If a legacy mode was stored ("native" | "http"), migrate it to "desktop"
  if (rawMode === "native" || rawMode === "http") {
    try {
      await browser.storage.local.set({ connectionMode });
    } catch {
      // Storage set non-critical failure
    }
  }

  return { appUrl, token, connectionMode };
}

export async function saveSettings(partial: Partial<ExtensionSettings>): Promise<void> {
  const toSave: Record<string, string> = {};

  if (partial.appUrl !== undefined) {
    toSave.appUrl = partial.appUrl.trim().replace(/\/+$/, "");
  }

  if (partial.token !== undefined) {
    toSave.token = partial.token.trim();
  }

  if (partial.connectionMode !== undefined) {
    toSave.connectionMode = normalizeConnectionMode(partial.connectionMode);
  }

  await browser.storage.local.set(toSave);

  const updated = await getSettings();
  for (const listener of changeListeners) {
    try {
      listener(updated);
    } catch {
      // Ignore listener error
    }
  }
}
