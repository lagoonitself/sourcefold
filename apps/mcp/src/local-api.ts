import { createLocalApi, type Database, type LocalApiWithDrive } from "@sourcefold/client";
import { parseHtmlOnServer } from "@sourcefold/core/server";
import { createClient } from "@supabase/supabase-js";
import { loadCredentials, type Credentials } from "./config";
import { createPublicFetch } from "./links/public-fetch";

// The desktop app signs in with Supabase and needs no website (docs/dev/handoff-no-website.md).
// With its sign-in, this server runs the website's API itself, the way the Chrome extension does
// when it borrows the desktop's sign-in: `createLocalApi` against Supabase, under RLS, with the
// desktop's access token read fresh from `session.json` on every request (the running app renews
// it about every hour).

export interface LocalFetchDeps {
  credentials?: () => Credentials | null;
  /** Called after anything that changes items or folders (the desktop app reloads). */
  onChanged?: () => void;
}

export function createLocalFetch(deps: LocalFetchDeps = {}) {
  const read = deps.credentials ?? (() => loadCredentials());
  let current: { key: string; api: LocalApiWithDrive } | null = null;

  function apiFor(creds: Credentials): LocalApiWithDrive {
    const sb = creds.supabase!;
    const key = `${sb.url}\n${sb.publishableKey}\n${sb.userId}`;
    if (current?.key === key) return current.api;
    current?.api.dispose();
    const supabase = createClient<Database>(sb.url, sb.publishableKey, {
      // supabase-js then sends this token on every request and never touches `auth`.
      accessToken: async () => {
        const fresh = read();
        return fresh?.supabase?.userId === sb.userId ? fresh.token : creds.token;
      },
    });
    const api = createLocalApi({
      supabase,
      // Links Claude adds must never reach this computer or the local network.
      fetchUrl: createPublicFetch(),
      parseHtml: parseHtmlOnServer,
      currentUserId: async () => sb.userId,
      onItemsChanged: deps.onChanged,
    });
    current = { key, api };
    return api;
  }

  return (creds: Credentials, pathAndQuery: string, init: RequestInit): Promise<Response> =>
    apiFor(creds).fetch(pathAndQuery, init);
}
