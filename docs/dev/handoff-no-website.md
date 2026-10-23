# Build contract: the desktop app and the extension work without the website

Status: contract written 2026-10-18, paused the same day, resumed 2026-10-23 on branch `desktop-first` (off `project-files`). See "Progress" at the end.

## Owner's decision (2026-10-18)

The desktop app and the extension must not depend on the website. You sign in with the same Google account everywhere, and everything works: saving, Drive, the local copy, highlights, search. The website becomes an optional place to see (and still save) sources. If the website is down or never deployed, the desktop app and the extension keep working.

The owner restated it on 2026-10-23: "I want the user to be able to sign in even with only the desktop app, and all features working with only the desktop app; web is optional." Choices made that day (the recommended options): Drive tokens come from the Edge Function below (not a separate Google "Desktop" client); Claude (MCP) starts the desktop app in the background when it is closed instead of using the website; the extension gets its own Google sign-in. Do this before shared projects (phase 2 in `docs/dev/PLAN-sharing.md`): once requests run under RLS, membership can be checked in the database rules instead of ~116 hand-written `user_id` filters.

## What stays and what goes

- **Stays:** Supabase (database, Auth with Google, Storage) and Google Drive. These are the account; every client talks to them directly.
- **Goes, for the desktop app and the extension:** every call to the website's `/api/*`, the website address field at sign-in, the `/desktop/connect` browser flow, and `sf_` API tokens. The website keeps those routes for older app versions; nothing new uses them.
- **New, tiny:** one Supabase Edge Function, `google-access-token`, because refreshing a Google token needs the OAuth client secret, which can't ship inside an open-source app. It is the only server code the desktop app and the extension use, and it lives in Supabase, not on the website.

## How it works

### Sign in (desktop)

1. The webview creates a Supabase client (`@supabase/supabase-js`, `flowType: "pkce"`) with the Supabase URL and anon key (see "Config").
2. Rust opens a loopback listener on `127.0.0.1:<random port>` (reuse the listener in `src-tauri/src/commands/auth.rs`), and the webview calls `signInWithOAuth({ provider: "google", options: { redirectTo: "http://127.0.0.1:<port>/callback", skipBrowserRedirect: true, scopes: "https://www.googleapis.com/auth/drive.file", queryParams: { access_type: "offline", prompt: "consent" } } })` and opens `data.url` in the system browser.
3. The callback brings `?code=…`; the webview calls `exchangeCodeForSession(code)`. The page the browser lands on says "Signed in. You can close this tab and go back to Sourcefold."
4. If the session has a `provider_refresh_token`, call the RPC `save_google_refresh_token(p_refresh_token)` (it uses `auth.uid()`, exactly like `apps/web/src/app/auth/callback/route.ts`).
5. supabase-js keeps the session (its storage is the webview's `localStorage`, key prefix `sourcefold:`), refreshes it by itself, and the webview hands the current access token, its expiry, user id and email to Rust (`session_set`) on every `onAuthStateChange`. Rust stores them in `session.json` for the native host and the loopback server; it never stores the Supabase refresh token.
6. Sign out: `supabase.auth.signOut()` and clear `session.json`. Old `session.json` files (web URL plus `sf_` token) are treated as signed out; the app shows the sign-in screen once.

### Sign in (extension)

- **Borrow from the desktop app:** when the desktop app is running and signed in, the loopback `/api/session` and the native host answer `{ signedIn, supabaseUrl, supabaseAnonKey, accessToken, expiresAt, userId, email }`. The extension uses that access token (never a refresh token; sharing one would break Supabase's refresh-token rotation). Same pinned-extension-ID checks as today.
- **Its own sign-in:** otherwise the options page and popup offer **Sign in with Google**: `chrome.identity.launchWebAuthFlow` with the same `signInWithOAuth` URL (PKCE), `redirectTo` = `chrome.identity.getRedirectURL()` (`https://<extension id>.chromiumapp.org/`), then `exchangeCodeForSession`. Session in `chrome.storage.local`. Also save the Google refresh token as in step 4.
- When both exist, prefer the extension's own session (it can refresh itself); use the desktop app's token only when the extension isn't signed in.

### Drive access token

`supabase/functions/google-access-token/index.ts` (Deno):

- `POST`, needs the caller's Supabase JWT (`Authorization: Bearer <access token>`). Verifies it with `supabase.auth.getUser()`.
- Checks `ALLOWED_EMAIL` (Edge Function secret; same rules as `isEmailAllowed` in `apps/web/src/lib/env.ts`; missing means `*`). Refused: 403 `{ error: { message: "This account can't use Sourcefold." } }`.
- Reads `google_tokens.refresh_token` for that user with the service role, refreshes it at `https://oauth2.googleapis.com/token` with secrets `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and answers `{ data: { access_token, expires_in } }`.
- Errors mirror `apps/web/src/lib/google/oauth.ts`: no refresh token or `invalid_grant` → 401 `{ error: { code: "drive_reconnect", message: "Reconnect Google Drive: sign out and sign in again." } }`; `unauthorized_client` → 500 `{ error: { code: "drive_client_mismatch", message: … } }`.
- Clients cache the token until 5 minutes before it expires.
- CORS: answer `OPTIONS` and send `Access-Control-Allow-Origin: *` with `Authorization, Content-Type, apikey, x-client-info` allowed (it is JWT-protected, so `*` is fine here, unlike the desktop loopback server).

### The local API (the heart of this change)

New workspace package `packages/client` (`@sourcefold/client`), browser-safe TypeScript (no Node built-ins, no `server-only`, no Next). It exports:

```ts
createLocalApi(deps: LocalApiDeps): { fetch(path: string, init?: RequestInit): Promise<Response> }

interface LocalApiDeps {
  supabase: SupabaseClient<Database>;       // signed in; RLS applies
  getDriveAccessToken(): Promise<string>;   // the Edge Function, cached
  sourceFetch: SourceFetch;                 // @sourcefold/core: fetches source pages (desktop: Rust web_fetch; extension: background fetch)
  binaryFetch(url: string): Promise<{ bytes: Uint8Array; contentType: string | null }>; // images to copy into Drive
  onItemsChanged?(): void;                  // e.g. desktop refreshes lists / local copy
}
createSupabase(config: { url: string; anonKey: string }, storage?: SupportedStorage): SupabaseClient<Database>
createDriveTokenSource(supabase, config): () => Promise<string>   // calls the Edge Function, caches
```

`fetch("/api/…")` answers **exactly** what the website's route answers today: same paths, methods, query parameters, request bodies, status codes, `{ data }` / `{ error: { message } }` envelopes and plain-text bodies. That is the whole contract for callers: the desktop's `httpFetch` / `remoteFetch` and the extension's web calls swap the network for `localApi.fetch` and nothing else changes. Port each route's logic from `apps/web/src/app/api/**/route.ts` and the modules it calls; use the route's own tests as the spec (copy and adapt them).

Routes to port: `GET /api/health`, `/api/folders` (GET, POST), `/api/folders/[id]` (GET, PATCH, DELETE), `/api/items` (GET list by `folder`, by `project`, title search by `q`), `/api/items/[id]/merge`, `/api/cards` (GET, POST), `/api/cards/[id]`, `/api/outline-sections` (GET, POST), `/api/outline-sections/[id]`, `/api/projects/[id]/export`, `/api/projects/[id]/import`, `/api/items/[id]/media`, `/api/items/[id]/media/[name]`, `/api/items/[id]/media-upload`, `/api/items/[id]` (GET, PATCH, DELETE), `/api/items/check`, `/api/items/[id]/content`, `/api/items/[id]/file`, `/api/capture`, `/api/grokipedia`, `/api/wikipedia`, `/api/source`, `/api/notes`, `/api/highlights` (GET, POST), `/api/highlights/[id]` (PUT, PATCH, DELETE), `/api/x/[itemId]/posts`, `/api/x/recent`, `/api/uploads`, `/api/uploads/sign`, `/api/drive/save`, `/api/drive/status`, `/api/mirror`. Not ported: `/api/tokens*`, `/desktop/connect`, `/auth/callback`.

Rules for the port:

- The user is `supabase.auth.getUser()`; cache the id per session. Keep every `user_id` filter and every `user_id` on inserts, even though RLS now applies.
- `publicFetch` (the website's SSRF guard) is server-only; the clients use `deps.sourceFetch`, which already runs on the user's own computer or browser.
- Where the website pushed to Drive "soon" after a save (`features/drive/push-to-drive-soon.ts`), the local API does the same in-process: a debounced push a few seconds after a capture, note, rename, move or delete, never two at once (the `acquire_drive_sync_lock` RPC already keeps the website and other clients out).
- Drive calls go straight to `https://www.googleapis.com` with `getDriveAccessToken()`. Third-party images go through `deps.binaryFetch` (browser CORS would block them).
- **Move, don't fork:** browser-safe modules the website uses (`features/drive/build-file.ts`, `google-doc.ts`, `google-doc-sync.ts`, `post-images.ts`, `run-save-batch.ts` minus its `server-only` token import, `lib/google/drive.ts`, `features/mirror/manifest.ts`, `features/highlights/load.ts`, the route helpers they need, and `lib/database.types.ts`) move into `packages/client`, and the website imports them from `@sourcefold/client` (leave a re-export at the old path if many files import it). The website's own behavior must not change, and its tests must keep passing.

### Desktop app

- `src/lib/remote-client.ts` / `src/lib/api.ts`: signed-in mode uses `localApi.fetch` instead of the website. Offline mode is unchanged.
- Welcome screen and Settings: **Sign in with Google** (no website field). An "Advanced" disclosure shows the Supabase URL and anon key (prefilled from the build, editable for self-hosters). Settings shows the signed-in email and **Sign out**. A link "Open on the web" appears only if a website address is set (optional field under Advanced, `VITE_SOURCEFOLD_WEB_URL` default).
- Drive: **Save to Drive** and Ctrl+S call `POST /api/drive/save` on the local API. Drive errors with `drive_reconnect` show "Reconnect Google Drive: sign out and sign in again."
- Local copy (`src-tauri/src/local_copy.rs`) no longer calls the website. The manifest and file bodies come from the local API in the webview; Rust keeps planning, writing, renaming and deleting files and its `local_copy_files` table. Suggested shape: the webview runs the pass (on start, focus, every 30 s, after saves) by getting `/api/mirror`, calling a Rust command with the manifest that returns the keys to download, fetching each body from `/api/items/[id]/content` (`?format=docx` for Word copies) and handing it to Rust to write. Keep the search index's `crate::search::notify()` after each pass.
- Loopback `/api/session` and the native host answer the new session shape above.

### Extension

- Target resolution (`lib/target.ts`): desktop app offline → save to the desktop (unchanged); otherwise save to the account through the extension's own `localApi` (own session, or the desktop's borrowed token). The target line reads "Saving to your account" or "Saving to this computer (desktop app, offline)". Not signed in anywhere → "Sign in with Google" button.
- Every former `fetch(`${webUrl}/api/…`)` goes through `localApi.fetch`. Drive push after a save runs in the background service worker.
- `wxt.config.ts`: add `identity` permission and host permissions for the Supabase URL and `https://www.googleapis.com/*` (plus what `binaryFetch` needs; the extension already has broad host access for capture: check).
- Options page: signed-in email, **Sign out**, Advanced (Supabase URL and anon key).

### Config

- Desktop: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Extension: `WXT_SUPABASE_URL`, `WXT_SUPABASE_PUBLISHABLE_KEY`. The publishable key (`sb_publishable_…`, what the website uses as `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) is public by design.
- `.github/workflows/desktop-release.yml`: from repository variables `SOURCEFOLD_SUPABASE_URL` and `SOURCEFOLD_SUPABASE_PUBLISHABLE_KEY` (both set on the owner's repo 2026-10-23). `SOURCEFOLD_WEB_URL` becomes optional.
- Local dev: `apps/desktop/.env.local` and `apps/extension/.env.local` (gitignored). Document in README.

### One-time setup (owner, in dashboards)

1. Supabase → Authentication → URL Configuration → Redirect URLs: add `http://127.0.0.1:*/**` and `https://ccgpcafkpkdfndhamegkcafmhfpkajml.chromiumapp.org/**`.
2. Deploy the Edge Function and set its secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (the same values as the website's), `ALLOWED_EMAIL`.
3. GitHub repository variables `SOURCEFOLD_SUPABASE_URL`, `SOURCEFOLD_SUPABASE_PUBLISHABLE_KEY`.
4. Authentication → Hooks → **Before user created** → Postgres function `public.hook_before_user_created` (after migration `20261023010000_signup_allow_list.sql` is applied). Keep `public.signup_allow_list` the same as `ALLOWED_EMAIL` (`*` = anyone).

## Known limits

- `ALLOWED_EMAIL` is enforced at sign-up by the "before user created" hook (`public.signup_allow_list`), by the website and by the Edge Function. Accounts made before an address was removed from the list can still sign in to Supabase; they just lose Drive.

## Done when

- With the website stopped (or its URL wrong), the desktop app signs in with Google, lists projects, saves links of every kind, pushes them to Drive, fills the local copy, and its search works.
- The extension, with the desktop app closed, signs in with Google and saves a page that lands in Drive; with the desktop app open and signed in, it saves without its own sign-in.
- The website still lists everything and still saves, and its tests pass.
- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` and `cargo test` pass; `packages/client` has tests for every ported route.

## Progress

Order of work: (0) owner tests `project-files`, merge; (1) Supabase groundwork; (2) `packages/client` routes; (3) desktop sign-in and the switch to the local API; (4) extension; (5) MCP starts the desktop app in the background instead of using the website; (6) release config and docs.

- **2026-10-23, step 1:**
  - RLS audit on the live database: every table the routes use (`folders`, `items`, `x_posts`, `highlights`, `cards`, `outline_sections`, `drive_state`) has select/insert/update/delete policies for the owner, and every function the routes call (`acquire_drive_sync_lock`, `mark_item_stored_in_drive`, `mark_item_synced`, `drive_dirty_items`, `soft_delete_folder`, …) is executable by `authenticated`. The non-definer ones run under RLS, so a wrong `p_user_id` finds nothing. Storage buckets `images` and `post-media` have owner policies. `google_tokens` has RLS and no policies, so only the Edge Function (service role) and `save_google_refresh_token` reach it. So no grants were needed.
  - `supabase/functions/google-access-token/index.ts` deployed to the owner's project (version 1, `verify_jwt: false` because it checks the token itself with `auth.getUser`). Without a token it answers 401; without its secrets it answers 500 "The Drive token service isn't set up yet."
  - Migration `20261023010000_signup_allow_list.sql` applied to the owner's database (allow list seeded with `*`; only `supabase_auth_admin` can run the hook). No new security advisor findings.
  - The owner set the Edge Function's three secrets (the MCP secret prompt had come back "declined"); with a fake token the function now answers 401 "Your sign-in expired", so its config is complete. Owner steps left: the redirect URLs (not confirmed yet; sign-in will fail without them) and turning on the hook in Authentication → Hooks.

- **2026-10-23, step 2 (first half): the website's API now lives in `packages/client`.** Changed from the original plan ("port each route and copy its tests"): the code was **moved**, not copied, so the website and the apps run one copy.
  - 36 modules (capture, Drive, folders, Grokipedia, highlights, items, mirror, project files, projects, research, `google/drive`, `database.types`, the fake test databases) moved with `git mv` into `packages/client/src/` under the same folder names; each old path in `apps/web/src` is a one-line `export *` re-export, so the website's UI imports didn't change. 8 module tests moved with them.
  - 29 route bodies moved into `packages/client/src/routes/<path>.ts` (`[id]` kept in the file names) as handlers `(auth: RouteContext, request, params) => Response`. `RouteContext` is `{ db, userId, via, host }`; the parameter is named `auth` so the bodies are unchanged. Each `apps/web/src/app/api/**/route.ts` is now a wrapper: `export const GET = webRoute(route.GET)` plus `dynamic` / `maxDuration` (Next config stays on the website). `webRoute` (`apps/web/src/lib/web-route.ts`) runs `requireApiUser` first, exactly where every handler used to, and passes `webHost`.
  - Not moved (website only): `/api/tokens*`, `/api/source`, `/api/wikipedia` (the desktop extracts pages itself and saves through `/api/capture`), `/api/health`, `/auth/*`, `/desktop/connect`.
  - **Host** (`packages/client/src/host.ts`): `drive` (`getAccessToken`, `clearAccessToken`, `isConnected`), `scheduleDrivePush`, `fetchUrl`, `parseHtml`. The website's is `apps/web/src/lib/web-host.ts` (+ `web-drive.ts`: `getGoogleAccessToken`, the admin `google_tokens` check, `publicFetch`, linkedom). The apps' Drive access is `createDriveAccess(supabase)` (`src/drive/token.ts`): the Edge Function, cached until 5 minutes before expiry, one request in flight per user, `drive_reconnect` → `DriveAuthError`.
  - Seams changed by hand: `runSaveBatch(db, userId, token, host, budget)`, `syncPostImages(…, groupFolderIds, fetchUrl, staged?)`, `getItemContent` / `getItemDocx` / `loadItemMedia(…, drive)`, `saveGrokipediaLink(…, host)` (Grokipedia is fetched with `host.fetchUrl`; on the website that is now `publicFetch`), `saveWikipediaLink(…, host)` (core's browser-safe `fetchWikipediaCapture` with the host's fetch and parser instead of `fetchWikipediaCaptureOnServer`), `/api/drive/status` asks `host.drive.isConnected`. `DriveAuthError` and `DriveClientMismatchError` live in `packages/client/src/google/errors.ts`; `apps/web/src/lib/google/oauth.ts` re-exports them, so `instanceof` matches.
  - Tests: web vitest aliases `server-only` to an empty module (`src/test/server-only.ts`); mocks of moved modules now name `@sourcefold/client/...` paths. Web 186 + client 76 = the 262 web tests from before, all passing; client and web typecheck clean, `npm run lint` clean, `next build` succeeds.
  - **Next (step 2, second half):** the router (`createLocalApi`: path table → handlers, `RouteContext` from the signed-in Supabase client, a debounced in-process Drive push with `acquire_drive_sync_lock`), `/api/health` in the router, ESLint for `packages/client` (it lost web's lint coverage), router tests (one request per route through `createLocalApi` with the fake db).
