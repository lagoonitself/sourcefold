# Handoff: Sourcefold MCP on the web, and links that wait for your computer

Branch `web-mcp` (off `main`, 2026-11-01). Orchestrator: Claude. This file is the contract between the agents; where it conflicts with an older handoff, this wins for this work.

## What the owner asked for

> An MCP that works on the web, not only through the desktop. The agent should be able to add any link. Some websites (Reddit, X, …) refuse a server. If a link can be added directly, add it. If not, it is fetched when the user opens the desktop app; and when Chrome with the extension and the desktop are both open, those are saved too. Every link added through the MCP ends up saved automatically.

So there are three workers, tried in this order for each link:

1. **Cloud** (the web MCP server on Vercel). Saves what a server can fetch: Grokipedia, Wikipedia, Hacker News, Bluesky, arXiv and PDFs, free Substack posts, most web pages.
2. **Desktop app** (the user's own connection). YouTube (cloud IPs are blocked), Reddit, paid Substack (the desktop holds the cookie), and any link the cloud was refused on. YouTube playlists, channels and Substack publications are expanded here, as Add links already does.
3. **Extension** (a real Chrome tab with the user's own sign-ins). X posts, and any page that refused the desktop too (Reddit often does). Runs only while the desktop app is also open (the owner's wording: "when the Chrome and the extension and the desktop both are open").

The hand-off between them is one Supabase table, `link_queue`.

## Already done by the orchestrator

- Migration `supabase/migrations/20261101000000_link_queue.sql`, **applied to the live database**. Read it: table `link_queue`, RLS for the owner, partial unique index on open rows `(user_id, folder_id, url)`, RPC `claim_link_queue(p_user_id, p_needs, p_worker, p_limit)` (claims the oldest `waiting` rows, or `working` rows claimed more than 10 minutes ago; sets `status='working'`, `claimed_by`, `claimed_at`, `attempts+1`; returns the rows).
- `packages/client/src/database.types.ts` updated with the table and the RPC. Do not hand-edit it further.

Row fields: `id, user_id, folder_id, url, kind, needs ('desktop'|'browser'), status ('waiting'|'working'|'saved'|'duplicate'|'unavailable'|'failed'|'cancelled'), claimed_by, claimed_at, attempts, message, title, item_id, added_by, created_at, updated_at`.

`message` is written for people: why it waits ("YouTube blocks cloud servers; waiting for the Sourcefold desktop app"), or why it failed.

## The queue API (shared route handlers in `packages/client`, owner: agent A)

Route modules in `packages/client/src/routes/link-queue*.ts`, registered in `packages/client/src/router.ts` (so the desktop's and extension's local API answer them), and thin wrappers in `apps/web/src/app/api/link-queue/**/route.ts` like every other route (`webRoute(...)`). Every query filters by `ctx.userId` (token routes use the admin client; see AGENTS.md / HANDOFF lessons). All answer `{ data }` or `{ error: { message } }`.

Exported type from `@sourcefold/client` (in `packages/client/src/types.ts` or a new `link-queue` module re-exported from the package index):

```ts
export type LinkQueueNeeds = "desktop" | "browser";
export type LinkQueueStatus =
  "waiting" | "working" | "saved" | "duplicate" | "unavailable" | "failed" | "cancelled";
export interface LinkQueueRow {
  id: string;
  folder_id: string;
  url: string;
  kind: string | null;
  needs: LinkQueueNeeds;
  status: LinkQueueStatus;
  claimed_by: string | null;
  claimed_at: string | null;
  attempts: number;
  message: string | null;
  title: string | null;
  item_id: string | null;
  added_by: string;
  created_at: string;
  updated_at: string;
}
```

| Method and path               | Body / query                                                                                                                                                                                                                                                  | Answer                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /api/link-queue`         | `?status=open` (waiting+working, default) or `recent` (any status, last 7 days); optional `needs=desktop\|browser`, `ids=a,b,c` (any status), `limit` (default 200, max 500)                                                                                  | `LinkQueueRow[]`, oldest first                                                                                  |
| `POST /api/link-queue`        | `{ folder_id, added_by?: string, links: [{ url, kind?, needs?, message? }] }` (1–200 links; `folder_id` must be a group, not a project: reuse `invalidFolderMessage`)                                                                                         | `LinkQueueRow[]` in input order. A link already open in that group returns the existing row instead of failing. |
| `POST /api/link-queue/claim`  | `{ needs, worker, limit? }` (`worker` ≤ 100 chars, e.g. `desktop:<random install id>`; limit 1–20, default 1)                                                                                                                                                 | `LinkQueueRow[]` claimed now (may be empty)                                                                     |
| `PATCH /api/link-queue/[id]`  | one of: result `{ status: "saved"\|"duplicate"\|"unavailable"\|"failed", message?, title?, item_id? }`; release `{ status: "waiting", message? }` (clears `claimed_by`/`claimed_at`); hand to the browser `{ status: "waiting", needs: "browser", message? }` | the updated row; 404 if not the user's                                                                          |
| `DELETE /api/link-queue/[id]` | none                                                                                                                                                                                                                                                          | sets `status='cancelled'` if open; 404 if not the user's                                                        |

## Agents and file ownership

Only edit files you own. Several agents work in this checkout at once. Ask the orchestrator (in your final report) for anything outside your files.

### Agent A: shared code (`packages/client` queue routes, `apps/mcp`) — GPT-6 Luna

1. The queue routes above, with Vitest tests like the other route tests in `packages/client`, and the `apps/web` wrappers (`apps/web/src/app/api/link-queue/**` only).
2. Export from `@sourcefold/client`:
   ```ts
   export function dispatchRoute(
     ctx: RouteContext,
     path: string,
     init?: RequestInit,
   ): Promise<Response>;
   ```
   Same matching as `createLocalApi` (404/405 JSON, errors become a 500 JSON), but with a caller-supplied `RouteContext` (no session lookup). Make `createLocalApi` use it internally so there is one router.
3. Make `apps/mcp` usable as a library by the website:
   - `apps/mcp/package.json`: add `"exports": { "./server": "./src/server-lib.ts" }` (or similar; tell agent B the exact specifier). `server-lib.ts` exports `createServer`, `createWebApi`, `ApiError`, `closedDesktopBridge`, `VERSION`, `INSTRUCTIONS`, and the `ToolContext` type. It must not import `node:fs`-only startup code at module load beyond what Node on Vercel can run (Node is fine; no `process.exit`, no stdio).
   - `createServer(ctx, { mode: "local" | "remote", addedBy?: string })`. `"local"` is today's stdio behaviour (default). `"remote"` is the web server.
   - `closedDesktopBridge`: a `DesktopBridge` whose `status()` is null, `changed()` does nothing, and the rest throw `DesktopClosedError`. Tools that need the desktop must still answer sensibly (find_sources falls back to titles, show_in_app says to open the desktop app).
   - **Stateless remote:** the web server builds a new `McpServer` per HTTP request. So in remote mode, nothing may depend on memory between calls: the short-id memory (`tools/short-ids.ts`) must not be needed to resolve ids printed in an earlier reply (print full ids in remote mode, or resolve a prefix with a database lookup scoped to the user), the module-level short-id map must not mix users (make it per `ToolContext`), and the Drive autosave timer (`drive-autosave.ts`) is off (the website's own route host already pushes to Drive after a change).
   - **`add_links` in remote mode:** for each link (after `extractUrls`, collections included):
     - Kinds a cloud server can't fetch go straight to the queue: YouTube (videos, playlists, channels) and Reddit with `needs: "desktop"`; X posts with `needs: "browser"` (unless the shared code can save an X post from a server; check `packages/core` and the extension's X path, and say what you found). Substack: try the cloud; a paid post (or a refusal) is queued for the desktop.
     - Everything else is tried in the cloud with the existing `saveLink` path (`links/save-link.ts`, Node `publicFetch`), one at a time, each with its own timeout, inside a total budget of about 40 s for the whole call. A refusal (HTTP 401/403/407/429/451/503, a bot or captcha page, a timeout, a network reset) queues the link for the desktop with a `message` saying why. A real failure (404, not a link, nothing to save) is reported as failed and not queued. Links left when the budget runs out are queued for the desktop.
     - `added_by` is the `addedBy` option (default `"Claude"`).
     - The reply lists what was saved (with ids), already saved, failed, and **waiting**: "N links are waiting for your computer. They'll be saved the next time the Sourcefold desktop app is open (X posts also need Chrome with the Sourcefold extension). Check with get_add_progress."
   - **`get_add_progress` in remote mode** reads `GET /api/link-queue` (open rows, plus recent finished ones if asked) and formats them like the local progress. Add `cancel_waiting_links` (ids, or all open in a group) using `DELETE`.
   - **Local (stdio) mode** keeps its in-process jobs, with one change: when the user is signed in and a row ends refused (the same refusal rules) or is an X post, queue it with `POST /api/link-queue` instead of marking it failed, and show it as "waiting for the desktop app" / "waiting for Chrome".
   - Update `INSTRUCTIONS` (remote mode wording: no desktop features unless open; links may wait for the user's computer).
   - Tests in `apps/mcp/src/__tests__` for remote add_links (fake fetch: one saved, one refused → queued, one YouTube → queued, one X → queued browser, budget exhaustion), get_add_progress, short ids in remote mode, and stdio queuing.
   - Keep the `.mcpb` build working (`npm run build -w @sourcefold/mcp`).

Owns: `packages/client/src/routes/link-queue*`, `packages/client/src/router.ts`, `packages/client/src/index.ts` (exports only), `packages/client/src/types.ts` (additions only), new tests in `packages/client`, `apps/web/src/app/api/link-queue/**`, everything in `apps/mcp/`.

### Agent B: the web MCP endpoint and sign-in (`apps/web`) — GPT-6 Luna

1. **Endpoint** `apps/web/src/app/api/mcp/route.ts`: Streamable HTTP, stateless (`WebStandardStreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js` with `sessionIdGenerator: undefined`, `enableJsonResponse: true`), a new server per request: `createServer(ctx, { mode: "remote", addedBy })` from agent A's export. `runtime = "nodejs"`, `maxDuration = 60`, `dynamic = "force-dynamic"`. `GET`/`DELETE` answer 405 as the spec allows for stateless servers. CORS: `Access-Control-Allow-Origin: *` is fine here **only because this route never reads cookies** (Bearer only; never fall back to the cookie session); expose `WWW-Authenticate` and `Mcp-Session-Id`, allow `Authorization, Content-Type, Mcp-Protocol-Version`; answer `OPTIONS`.
   - `ToolContext`: `api` = `createWebApi({ credentials: () => ({ ...placeholder web url and token, source: "settings" }), fetch: (input, init) => dispatchRoute(routeCtx, pathAndQuery(input), init) })`, so tools run the shared route handlers in-process as the authenticated user (`routeCtx = { db, userId, via, host: webHost }`); `desktop` = `closedDesktopBridge`. Read `createWebApi`'s credential type and the placeholder it needs.
   - `addedBy`: "Claude" / "ChatGPT" / the OAuth client's name / "MCP", from the token (OAuth `client_id` → client name if Supabase gives it cheaply; otherwise the MCP `clientInfo.name` from `initialize` is not available statelessly, so keep it simple).
   - PDFs: the save path loads pdf.js. Make sure it works in the Next server bundle (`serverExternalPackages` or the same `loadPdfJs` trick as `apps/mcp/src/links/save-link.ts`). Check `next build` output.
2. **Auth** (`apps/web/src/lib/mcp-auth.ts`), Bearer only, two kinds:
   - An existing `sf_` access token (Settings → Create token): same lookup as `requireApiUser` (reuse its code; don't duplicate the hashing). For Claude Code, Cursor and any client that can send a header.
   - A Supabase OAuth 2.1 access token (Supabase's OAuth Server issues normal Supabase JWTs for the user, with a `client_id` claim). Verify it with Supabase (`auth.getClaims` / `auth.getUser(jwt)` on this project), check `ALLOWED_EMAIL` (`isEmailAllowed`), and use an **RLS client** carrying that JWT (`createClient(url, publishableKey, { global: { headers: { Authorization: "Bearer <jwt>" } }, auth: { persistSession: false } })`), `via: "session"`.
   - Failure: 401 with `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/api/mcp"` and a JSON-RPC-friendly body.
3. **Discovery** (RFC 9728 / MCP authorization spec):
   - `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp`: `{ resource: "<origin>/api/mcp", authorization_servers: ["<SUPABASE_URL>/auth/v1"], bearer_methods_supported: ["header"], resource_name: "Sourcefold" }`.
   - `/.well-known/oauth-authorization-server` (some clients look at the resource's origin): answer with Supabase's own metadata, fetched from `<SUPABASE_URL>/.well-known/oauth-authorization-server/auth/v1` and cached briefly. Check that address in Supabase's docs (OAuth 2.1 Server, "MCP authentication") and use the right one.
   - Origin: use the request's origin (works for previews and self-hosters); `NEXT_PUBLIC_SITE_URL` style env only if one already exists.
4. **Consent page** `/oauth/consent` (path configured in Supabase as the OAuth Server's authorization path). Supabase sends the browser there with `?authorization_id=…`. If not signed in, sign in with Google through the website's existing flow and come back (keep `authorization_id`). Then show: which app asks (client name, redirect host), the signed-in email, what it can do ("read and change your Sourcefold library, and add links"), and **Allow** / **Deny** buttons → `supabase.auth.oauth.approveAuthorization(id)` / `denyAuthorization(id)` (supabase-js already has `auth.oauth`), then go to the returned redirect URL. Refuse accounts `ALLOWED_EMAIL` doesn't allow. Follow `docs/dev/DESIGN.md` and the website's existing look and copy rules.
5. **Settings** on the website: a short section "Use Sourcefold in Claude or ChatGPT on the web" with the connector URL (`<origin>/api/mcp`) and a Copy button, and one line each for claude.ai (Settings → Connectors → Add custom connector, paste the URL) and for apps that take a header (use a token from Create token).
6. Tests (Vitest, like the existing route tests): auth (sf_ token, OAuth JWT, missing/invalid → 401 with the header, not allowed email → 403), protected-resource metadata, a stateless `initialize` + `tools/list` + one `tools/call` through the route with mocks, CORS preflight.
7. Docs: `docs/INSTALL.md` (how to add the connector in claude.ai and ChatGPT, and what "waiting for your computer" means), `docs/SELF-HOSTING.md` (Supabase → Authentication → OAuth Server: enable, authorization path `/oauth/consent`, allow dynamic client registration), README rows for the web MCP.

Dependencies: `apps/web` may add `"@sourcefold/mcp": "*"` and `"@modelcontextprotocol/sdk"` (same version range as `apps/mcp`) and list `@sourcefold/mcp` in `transpilePackages`. Nothing else without asking.

Owns: `apps/web/src/app/api/mcp/**`, `apps/web/src/app/.well-known/**`, `apps/web/src/app/oauth/**`, `apps/web/src/lib/mcp-*.ts`, the website's Settings page files for the new section, `apps/web/next.config.*`, `apps/web/package.json`, `apps/web` tests for these, `docs/INSTALL.md`, `docs/SELF-HOSTING.md`, `README.md`. Not `apps/web/src/app/api/link-queue/**` (agent A).

Until agent A lands `dispatchRoute` and `@sourcefold/mcp/server`, code against the signatures above.

### Agent C: the desktop app drains the queue (`apps/desktop`) — Grok 4.7

- Signed in only (offline mode has no queue). While the app runs: on start, on window focus, every 30 s with the app's existing refreshes, never two runs at once, stop on sign-out.
- Claim with `POST /api/link-queue/claim { needs: "desktop", worker: "desktop:<install id>", limit: 5 }` through the app's local API (`@/lib/api` helpers), then save each link with **the same code Add links uses** (find it: `features/sources/source-client.ts`, Grokipedia, Wikipedia, Substack, YouTube with its pacing in `youtube-pacing.ts`, playlists/channels/publications expanded into their videos/posts). Do not write a second copy of any extractor.
- Report each row with `PATCH /api/link-queue/[id]`: `saved` (+ `item_id`, `title`), `duplicate`, `unavailable` (e.g. no captions), `failed` (+ the message the Add links row would show). A collection row is `saved` when its children are done, with a message like "Saved 23 of 25 videos".
- When the site refuses this computer too (Reddit 403/429, a bot or captcha page, "This site refused…" errors from the shared fetch), or the link is an X post: `PATCH { status: "waiting", needs: "browser", message: "Needs Chrome with the Sourcefold extension" }`.
- YouTube rate limit: use the existing pacing (wait 1 min, then 3 min); if still blocked, release the row (`status: "waiting"` with the message) and stop draining YouTube until the next run.
- UI, small, following `docs/dev/DESIGN.md`: while it works, a quiet status (where Add links shows progress, or the top bar) "Saving links from Claude: 2 of 5"; afterwards the group lists refresh so the new sources show up; a toast when a batch finishes ("Saved 4 links Claude added. 1 needs Chrome."). Also show the count of links waiting for Chrome somewhere unobtrusive with a hint to open Chrome.
- Tests (Vitest, `apps/desktop/src/**/__tests__`) for the drain loop: claim → save → patch, refusal → browser, X → browser, rate limit → release, no overlap, stops when signed out. Keep `ipc-contract.test.ts` passing (no new Rust commands should be needed; if one is, say why).

Owns: new files under `apps/desktop/src/features/link-queue/`, plus the smallest hook-up edits in the app shell / refresh loop / status area (list every existing file you touch in your report).

### Agent D: the extension saves what needs a browser (`apps/extension`) — Grok 4.7

- Background worker, signed in (its own sign-in or the desktop's), **and only while the desktop app is reachable** (reuse the existing target resolution / ping). A `chrome.alarms` alarm every 1 minute, plus on startup and when the popup opens.
- Claim one row at a time: `POST /api/link-queue/claim { needs: "browser", worker: "extension:<id>", limit: 1 }` through the extension's local API.
- Host permission: the link's origin must be granted (`optional_host_permissions` already lists `https://*/*`). `chrome.permissions.contains`; if missing, release the row (`status: "waiting"`, message "Allow Sourcefold to open <host> in Chrome"), set the badge, and let the popup show a banner "N links need your OK to open x.com, reddit.com" with an **Allow** button that calls `chrome.permissions.request` for exactly those origins (it needs the click). Do not add new required permissions or host permissions to the manifest (that disables the extension on update until the user accepts).
- Open the link in an inactive tab (`chrome.tabs.create({ url, active: false })`), wait for it to finish loading (and for X, until the post is rendered; reuse whatever waiting the capture script already does), run **the same capture script and save path the popup uses** into the row's `folder_id`, close the tab (also on failure and on timeout, ~45 s), and `PATCH` the row: `saved`/`duplicate`/`unavailable`/`failed` with the message the popup would show. A page that needs sign-in (X login wall) → `failed` with "Sign in to x.com in Chrome, then press Retry" style message (and leave a way to retry: the popup banner offers **Retry** which sets failed browser rows back to waiting via `PATCH`).
- Pace: a few seconds between links; never more than one tab at a time; stop when the desktop app goes away.
- Popup: the banner above, plus "Saving 1 of 3 links Claude added…" while it works. Follow `docs/dev/DESIGN.md` and the popup's current look.
- Tests (Vitest, like the extension's existing tests) for the worker: claim → tab → capture → patch, permission missing → release + banner state, tab closed on timeout, nothing runs without the desktop.

Owns: new files under `apps/extension/src/link-queue/` (or the extension's existing folder layout), plus the smallest hook-up edits in `entrypoints/background.ts` and the popup (list every existing file you touch).

## Rules for every agent

- Read `AGENTS.md` first and follow it (no git commands, no new dependencies beyond your brief, only your files, never disable checks).
- Don't simplify or rewrite code outside your task, and never delete tests. Past agents did; the orchestrator diffs every file.
- Before reporting done run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` from the repo root (and `cargo test` in `apps/desktop/src-tauri` only if you touched Rust). Report the results honestly, including failures caused by another agent's unfinished files.
- Final report: files created/changed, commands and results, what's unfinished, questions.

## Owner steps (after the build)

- Supabase → Authentication → OAuth Server: enable it, authorization path `/oauth/consent`, allow dynamic client registration.
- Deploy (push `main`), then in claude.ai: Settings → Connectors → Add custom connector → `https://<website>/api/mcp`.
