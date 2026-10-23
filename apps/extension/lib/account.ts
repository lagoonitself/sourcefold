import { browser } from "wxt/browser";
import { createClient, type SupportedStorage } from "@supabase/supabase-js";
import {
  OAUTH_QUERY_PARAMS,
  OAUTH_SCOPES,
  createLocalApi,
  createSupabase,
  type ClientConfig,
  type Database,
  type LocalApiWithDrive,
  type SourcefoldSupabase,
} from "@sourcefold/client";
import { parseHtmlOnServer } from "@sourcefold/core/server";
import { getSupabaseConfig, isSupabaseConfigured } from "./settings";
import {
  invalidateTargetCache,
  isBorrowable,
  resolveTarget,
  type DesktopSessionSignedIn,
  type OwnAccount,
  type ResolvedTarget,
} from "./target";

// Background only. The extension saves to the account itself, without the website: the
// website's API runs here (`createLocalApi` from @sourcefold/client) against Supabase and Google
// Drive. It signs in with Google itself, or borrows the desktop app's current access token (never
// a refresh token). Contract: docs/dev/handoff-no-website.md, "Sign in (extension)".
//
// Only this worker holds a Supabase client: two clients refreshing one session would fight over
// Supabase's rotating refresh token. The popup and options page ask through messages
// (lib/account-channel.ts).

/** supabase-js keeps the session (and the PKCE verifier during sign-in) in chrome.storage. */
const chromeStorage: SupportedStorage = {
  async getItem(key) {
    const result = await browser.storage.local.get([key]);
    const value = result[key];
    return typeof value === "string" ? value : null;
  },
  async setItem(key, value) {
    await browser.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await browser.storage.local.remove([key]);
  },
};

const configKey = (config: ClientConfig) =>
  `${config.supabaseUrl}\n${config.supabasePublishableKey}`;

let own: { key: string; supabase: SourcefoldSupabase; api: LocalApiWithDrive | null } | null = null;

async function ownClient(): Promise<SourcefoldSupabase> {
  const config = await getSupabaseConfig();
  if (!isSupabaseConfigured(config)) {
    throw new Error("This copy of Sourcefold has no account server set. Add it in Options.");
  }
  const key = configKey(config);
  if (!own || own.key !== key) {
    own?.api?.dispose();
    own = { key, supabase: createSupabase(config, chromeStorage), api: null };
  }
  return own.supabase;
}

/** The extension's own sign-in, or null. Refreshes an expired session on the way. */
export async function getOwnAccount(): Promise<OwnAccount | null> {
  const config = await getSupabaseConfig();
  if (!isSupabaseConfigured(config)) return null;
  const supabase = await ownClient();
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  return user ? { userId: user.id, email: user.email ?? undefined } : null;
}

// The desktop app's sign-in, borrowed. Its token is replaced whenever the target is resolved.
let borrowed: {
  key: string;
  session: DesktopSessionSignedIn;
  api: LocalApiWithDrive;
} | null = null;

function rememberDesktopSession(session: DesktopSessionSignedIn): void {
  const key = `${configKey(session)}\n${session.userId}`;
  if (borrowed && borrowed.key === key) {
    borrowed.session = session;
    return;
  }
  borrowed?.api.dispose();
  const holder = { key, session, api: null as unknown as LocalApiWithDrive };
  const supabase = createClient<Database>(session.supabaseUrl, session.supabasePublishableKey, {
    // With `accessToken`, supabase-js sends this token on every request and never touches
    // `auth`; the router is told the user directly.
    accessToken: async () => {
      if (!isBorrowable(holder.session)) {
        await resolveTarget({ forceRefresh: true, deps: targetDeps });
      }
      return holder.session.accessToken;
    },
  });
  holder.api = createLocalApi({
    supabase,
    fetchUrl: (url, init) => fetch(url, init),
    parseHtml: parseHtmlOnServer,
    currentUserId: async () => holder.session.userId,
  });
  borrowed = holder;
}

const targetDeps = {
  getOwnAccount,
  onDesktopSession: rememberDesktopSession,
};

/** Where saves go, with the background's sign-ins. */
export function resolveAccountTarget(forceRefresh = false): Promise<ResolvedTarget> {
  return resolveTarget({ forceRefresh, deps: targetDeps });
}

async function ownApi(): Promise<LocalApiWithDrive> {
  const supabase = await ownClient();
  if (!own!.api) {
    own!.api = createLocalApi({
      supabase,
      fetchUrl: (url, init) => fetch(url, init),
      parseHtml: parseHtmlOnServer,
    });
  }
  return own!.api;
}

export interface AccountRequest {
  path: string;
  method?: string;
  body?: string;
}

export interface AccountResponse {
  status: number;
  body: string;
}

function errorAnswer(status: number, message: string): AccountResponse {
  return { status, body: JSON.stringify({ error: { message } }) };
}

/** Runs one `/api/...` request against the account, as the website would answer it. */
export async function accountFetch(request: AccountRequest): Promise<AccountResponse> {
  const target = await resolveAccountTarget();
  if (target.type !== "account") return errorAnswer(401, target.displayLabel);
  const api = target.via === "extension" ? await ownApi() : borrowed?.api;
  if (!api) {
    invalidateTargetCache();
    return errorAnswer(401, "Sign in to continue.");
  }
  try {
    const res = await api.fetch(request.path, {
      method: request.method ?? "GET",
      body: request.body,
      headers: request.body ? { "Content-Type": "application/json" } : undefined,
    });
    if (res.status === 401) invalidateTargetCache();
    return { status: res.status, body: await res.text() };
  } catch (err) {
    invalidateTargetCache();
    return errorAnswer(0, err instanceof Error ? err.message : "Couldn't reach your account.");
  }
}

export interface AccountStatus {
  signedIn: boolean;
  email?: string;
}

export async function accountStatus(): Promise<AccountStatus> {
  const account = await getOwnAccount().catch(() => null);
  return account ? { signedIn: true, email: account.email } : { signedIn: false };
}

const SIGN_IN_CANCELLED = "Sign-in was cancelled.";

/** Google sign-in in a browser window (PKCE); the session stays in chrome.storage. */
export async function signIn(): Promise<AccountStatus> {
  const supabase = await ownClient();
  const redirectTo = browser.identity.getRedirectURL();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      scopes: OAUTH_SCOPES,
      queryParams: { ...OAUTH_QUERY_PARAMS },
    },
  });
  if (error || !data.url) throw new Error(error?.message || "Couldn't start the sign-in.");

  let finalUrl: string | undefined;
  try {
    finalUrl = await browser.identity.launchWebAuthFlow({ url: data.url, interactive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    throw new Error(/cancel|closed|did not approve/i.test(message) ? SIGN_IN_CANCELLED : message);
  }
  if (!finalUrl) throw new Error(SIGN_IN_CANCELLED);

  const back = new URL(finalUrl);
  const params = new URLSearchParams(back.hash.replace(/^#/, ""));
  back.searchParams.forEach((value, key) => params.set(key, value));
  const refused = params.get("error_description") || params.get("error");
  if (refused) throw new Error(refused.replace(/\+/g, " "));
  const code = params.get("code");
  if (!code) throw new Error("The sign-in didn't finish. Try again.");

  const exchanged = await supabase.auth.exchangeCodeForSession(code);
  if (exchanged.error || !exchanged.data.session) {
    throw new Error(exchanged.error?.message || "The sign-in didn't finish. Try again.");
  }
  const session = exchanged.data.session;

  // Drive needs Google's refresh token on the account, as the website's /auth/callback saves it.
  if (session.provider_refresh_token) {
    const { error: rpcError } = await supabase.rpc("save_google_refresh_token", {
      p_refresh_token: session.provider_refresh_token,
    });
    if (rpcError) console.error("Failed to save the Google refresh token", rpcError);
  }

  invalidateTargetCache();
  return { signedIn: true, email: session.user.email ?? undefined };
}

/** Signs this browser out (the website and other devices stay signed in). */
export async function signOut(): Promise<void> {
  // After the worker restarts there's no client yet, but the session is still in storage.
  if (isSupabaseConfigured(await getSupabaseConfig())) await ownClient().catch(() => null);
  if (own) {
    const current = own;
    if (current.api) {
      await current.api.flushDrivePush().catch((err) => console.warn("Drive push failed", err));
      current.api.dispose();
      current.api = null;
    }
    await current.supabase.auth
      .signOut({ scope: "local" })
      .catch((err) => console.warn("Supabase sign-out failed", err));
  }
  invalidateTargetCache();
}

/** Forgets the clients after the Supabase project changed under Options → Advanced. */
export function resetAccountClients(): void {
  own?.api?.dispose();
  own = null;
  borrowed?.api.dispose();
  borrowed = null;
  invalidateTargetCache();
}
