import { createSupabase, type ClientConfig, type SourcefoldSupabase } from "@sourcefold/client";

// The account lives in Supabase; the desktop app signs in and reads and writes there directly,
// without the website (docs/dev/handoff-no-website.md). The address and publishable key come from
// the build (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`); self-hosters can change them
// under Settings → Advanced. The publishable key is public by design.

export const SUPABASE_CONFIG_STORAGE_KEY = "sourcefold:supabase_config";

const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;

export const BUILD_SUPABASE_CONFIG: ClientConfig = {
  supabaseUrl: env.VITE_SUPABASE_URL ?? "",
  supabasePublishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
};

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function clean(config: ClientConfig): ClientConfig {
  return {
    supabaseUrl: config.supabaseUrl.trim().replace(/\/+$/, ""),
    supabasePublishableKey: config.supabasePublishableKey.trim(),
  };
}

/** The build's Supabase project, or the one picked under Settings → Advanced. */
export function getSupabaseConfig(): ClientConfig {
  const raw = storage()?.getItem(SUPABASE_CONFIG_STORAGE_KEY);
  if (raw) {
    try {
      const saved = JSON.parse(raw) as Partial<ClientConfig>;
      if (saved.supabaseUrl && saved.supabasePublishableKey) {
        return clean({
          supabaseUrl: saved.supabaseUrl,
          supabasePublishableKey: saved.supabasePublishableKey,
        });
      }
    } catch {
      // A broken value falls back to the build's.
    }
  }
  return clean(BUILD_SUPABASE_CONFIG);
}

export function isSupabaseConfigured(config: ClientConfig = getSupabaseConfig()): boolean {
  return Boolean(config.supabaseUrl && config.supabasePublishableKey);
}

/** Checks an address typed under Advanced. Returns the problem, or null. */
export function supabaseConfigProblem(config: ClientConfig): string | null {
  const { supabaseUrl, supabasePublishableKey } = clean(config);
  if (!supabaseUrl) return "Enter the Supabase address.";
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    return "That isn't a web address.";
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    return "The address must start with https://.";
  }
  if (!supabasePublishableKey) return "Enter the publishable key.";
  return null;
}

let client: SourcefoldSupabase | null = null;
let clientFor = "";

/** The one Supabase client for the configured project. Its session lives in localStorage. */
export function getSupabase(): SourcefoldSupabase {
  const config = getSupabaseConfig();
  const key = `${config.supabaseUrl}\n${config.supabasePublishableKey}`;
  if (!client || clientFor !== key) {
    if (!isSupabaseConfigured(config)) {
      throw new Error("This copy of Sourcefold has no account server set. Add it under Advanced.");
    }
    client = createSupabase(config);
    clientFor = key;
  }
  return client;
}

/** Saves the Advanced choice (null goes back to the build's). Sign out before changing it. */
export function setSupabaseConfig(config: ClientConfig | null): void {
  const store = storage();
  if (config) store?.setItem(SUPABASE_CONFIG_STORAGE_KEY, JSON.stringify(clean(config)));
  else store?.removeItem(SUPABASE_CONFIG_STORAGE_KEY);
  client = null;
  clientFor = "";
}
