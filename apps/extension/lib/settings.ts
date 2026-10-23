import { browser } from "wxt/browser";
import type { ClientConfig } from "@sourcefold/client";

/**
 * Auto: the extension's own sign-in, else the desktop app (its offline library, or its sign-in).
 * Desktop: only ever the desktop app. Older versions had "web" (a website address and an `sf_`
 * token) and "native" / "http"; those read as auto and desktop.
 */
export type ConnectionMode = "auto" | "desktop";

export interface ExtensionSettings {
  connectionMode: ConnectionMode;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  connectionMode: "auto",
};

export function normalizeConnectionMode(mode: unknown): ConnectionMode {
  if (mode === "desktop" || mode === "native" || mode === "http") {
    return "desktop";
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

// Invalidation listeners can be registered (e.g. Target Resolver cache)
type SettingsChangeListener = (settings: ExtensionSettings) => void;
const changeListeners: SettingsChangeListener[] = [];

export function onSettingsChanged(listener: SettingsChangeListener): () => void {
  changeListeners.push(listener);
  return () => {
    const idx = changeListeners.indexOf(listener);
    if (idx !== -1) changeListeners.splice(idx, 1);
  };
}

const LEGACY_KEYS = ["appUrl", "token"];

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.local.get(["connectionMode", ...LEGACY_KEYS]);
  const rawMode = result.connectionMode;
  const connectionMode = normalizeConnectionMode(rawMode);

  // Older versions kept a website address and an `sf_` token; nothing uses them any more.
  if (rawMode !== undefined && rawMode !== connectionMode) {
    await browser.storage.local.set({ connectionMode }).catch(() => {});
  }
  if (LEGACY_KEYS.some((key) => key in result)) {
    await browser.storage.local.remove(LEGACY_KEYS).catch(() => {});
  }

  return { connectionMode };
}

function notify(settings: ExtensionSettings): void {
  for (const listener of changeListeners) {
    try {
      listener(settings);
    } catch {
      // Ignore listener error
    }
  }
}

export async function saveSettings(partial: Partial<ExtensionSettings>): Promise<void> {
  if (partial.connectionMode !== undefined) {
    await browser.storage.local.set({
      connectionMode: normalizeConnectionMode(partial.connectionMode),
    });
  }
  notify(await getSettings());
}

// The account lives in Supabase. Release builds set WXT_SUPABASE_URL and
// WXT_SUPABASE_PUBLISHABLE_KEY (public by design); self-hosters can change them in Options.
const SUPABASE_CONFIG_KEY = "supabaseConfig";

const env = ((import.meta as { env?: Record<string, string | undefined> }).env ?? {}) as Record<
  string,
  string | undefined
>;

export const BUILD_SUPABASE_CONFIG: ClientConfig = {
  supabaseUrl: env.WXT_SUPABASE_URL ?? "",
  supabasePublishableKey: env.WXT_SUPABASE_PUBLISHABLE_KEY ?? "",
};

function cleanConfig(config: ClientConfig): ClientConfig {
  return {
    supabaseUrl: config.supabaseUrl.trim().replace(/\/+$/, ""),
    supabasePublishableKey: config.supabasePublishableKey.trim(),
  };
}

/** The build's Supabase project, or the one picked under Options → Advanced. */
export async function getSupabaseConfig(): Promise<ClientConfig> {
  const result = await browser.storage.local.get([SUPABASE_CONFIG_KEY]);
  const saved = result[SUPABASE_CONFIG_KEY] as Partial<ClientConfig> | undefined;
  if (saved?.supabaseUrl && saved.supabasePublishableKey) {
    return cleanConfig({
      supabaseUrl: saved.supabaseUrl,
      supabasePublishableKey: saved.supabasePublishableKey,
    });
  }
  return cleanConfig(BUILD_SUPABASE_CONFIG);
}

/** Whether the Advanced value differs from the build's. */
export async function hasCustomSupabaseConfig(): Promise<boolean> {
  const result = await browser.storage.local.get([SUPABASE_CONFIG_KEY]);
  return Boolean(result[SUPABASE_CONFIG_KEY]);
}

export function isSupabaseConfigured(config: ClientConfig): boolean {
  return Boolean(config.supabaseUrl && config.supabasePublishableKey);
}

/** Checks an address typed under Advanced. Returns the problem, or null. */
export function supabaseConfigProblem(config: ClientConfig): string | null {
  const { supabaseUrl, supabasePublishableKey } = cleanConfig(config);
  if (!supabaseUrl) return "Enter the Supabase address.";
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    return "That isn't a web address.";
  }
  if (url.protocol !== "https:" && !(isLocalUrl(supabaseUrl) && url.protocol === "http:")) {
    return "The address must start with https://.";
  }
  if (!supabasePublishableKey) return "Enter the publishable key.";
  return null;
}

/** Saves the Advanced choice (null goes back to the build's). */
export async function setSupabaseConfig(config: ClientConfig | null): Promise<void> {
  if (config) await browser.storage.local.set({ [SUPABASE_CONFIG_KEY]: cleanConfig(config) });
  else await browser.storage.local.remove([SUPABASE_CONFIG_KEY]);
  notify(await getSettings());
}
