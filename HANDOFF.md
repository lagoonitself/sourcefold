# Sourcefold handoff

Read this first in any new session. When the user says "continue", pick up at **Next steps** below, starting with the first unchecked item. Keep this file current: when you finish a step, tick it, add what you learned, and commit.

Last updated: 2026-10-13, after commit `2806278`. Work was paused by the user at that point.

## What we're building

Sourcefold is a personal, open-source (MIT) research source collector. The user collects sources for YouTube video research and feeds them into NotebookLM, Gemini and other tools.

- **Sources:** Grokipedia articles (bulk-paste 30–40 links), Substack posts (free posts, plus paid posts the user subscribes to), and X posts (text only, threads kept as a tree).
- **Format:** every source is stored as clean Markdown.
- **Organizing:** folders inside folders, unlimited depth. Each item lives in one folder.
- **Reading:** clicking an item opens the original page. The app never shows the content itself.
- **Drive:** one **Save to Drive** button (and Ctrl+S) mirrors the folders and `.md` files into the user's Google Drive. It's one-way: the app's database is the master.
- **Chrome extension:** saves the page you're viewing into a chosen folder in one click. This is the most important feature for the user.
- **Constraints:** $0 budget (free tiers only), desktop web app, single user per deployment (`ALLOWED_EMAIL`), search by title only.
- **Out of scope for now:** a future public website per video, where each claim links to its source.

Full detail:

| File                             | What it holds                                                               |
| -------------------------------- | --------------------------------------------------------------------------- |
| `docs/SPEC.md`                   | Product and technical spec: data model, Markdown formats, API, waves        |
| `docs/DESIGN.md`                 | Visual system (tokens, fonts, layout, copy rules); every UI task follows it |
| `docs/ROADMAP.md`                | Checklist of done and remaining work                                        |
| `AGENTS.md`                      | Rules every coding agent follows                                            |
| `docs/open-source-references.md` | Projects to borrow from (Substack and X capture)                            |

## Current state

**Built and committed** (the production build passes with type checking on; 74 core tests pass):

- **Database:** live Supabase schema with row-level security (`supabase/migrations/20261013000000_initial_schema.sql`, already applied). Tables: `folders`, `items`, `x_posts`, `api_tokens`, `google_tokens`, `drive_state`. RPCs: `soft_delete_folder`, `save_google_refresh_token`, `health`.
- **Sign-in:**
  - Google sign-in requesting the `drive.file` scope with offline access.
  - The callback saves the Google refresh token through an RPC.
  - The allow-list is enforced in both the callback and `src/proxy.ts`.
  - `safeRedirectPath` blocks open redirects.
- **App shell:** sidebar, top bar, and design tokens and fonts from DESIGN.md.
- **Folders:** API (`/api/folders`, `/api/folders/[id]`) and the sidebar tree: create, rename, nest, drag into a folder or to the top level, delete with confirmation, keyboard navigation.
- **Items:** folder view with a serif heading, item rows with source colours and statuses, and title search (`?q=`). `GET /api/items` serves the extension.
- **Grokipedia:**
  - Parser in `packages/core/src/grokipedia/`: title, summary, fact-checked date, body with paragraphs, tables and links, and every reference as a GFM footnote.
  - `POST /api/grokipedia` (fetch, parse, store) with duplicate detection; `POST /api/items/check`.
  - The "Add links" paste box: sequential queue with per-link status, retry and stop.
- **Extension:** skeleton in `apps/extension` (WXT 0.21, React). Popup with page detection, settings page (app URL, token, "Test connection"), a right-click menu stub. No capture logic yet.
- **CI:** `.github/workflows/ci.yml` (format, lint, typecheck, test, build) and `keep-alive.yml` (a daily ping of `$APP_URL/api/health`).

**Verified in a browser or with curl:**

- The login page renders correctly.
- Signed-out users are redirected to `/login`.
- `/api/health` reaches the database.
- The APIs return 401 without a session.

**Not verified yet:** anything that needs sign-in (folder tree interactions, the paste box end to end, search with real data). Whether the GitHub Actions CI run passes is also unchecked.

## Accounts and resources

| Thing                | Value                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub repo          | `github.com/lagoonitself/sourcefold` (public, `main` branch). The `gh` CLI is logged in as `lagoonitself`; its stored label says `anilreddy2569900-maker`, an old name.                                                                                                                                                                                                              |
| App Google account   | `anilreddy2569900@gmail.com`. This is `ALLOWED_EMAIL` and the Drive owner.                                                                                                                                                                                                                                                                                                           |
| Google Cloud project | `sourcefold`, project ID **`folder-511509`**. Drive API is **enabled**. The local `gcloud` CLI is logged in as other family accounts; don't use it for this project.                                                                                                                                                                                                                 |
| Supabase             | Project `sourcefold`, ref **`dhqrexvkinplupshqyma`**, region `ap-southeast-1`, org "Roleplay" (free plan). URL `https://dhqrexvkinplupshqyma.supabase.co`. The Supabase MCP is connected and can apply migrations, generate types and run advisors.                                                                                                                                  |
| Local env            | `apps/web/.env.local` (gitignored) holds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (get it with the Supabase MCP `get_publishable_keys`) and `ALLOWED_EMAIL`. Not set yet: `SUPABASE_SECRET_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (needed from Wave 3 and Wave 5). Ask the user to paste secrets into `.env.local` themselves; never print them. |
| Vercel               | Not set up yet. The Vercel CLI is installed and logged in; a Vercel MCP is available.                                                                                                                                                                                                                                                                                                |

## Blocking: the user's setup steps

Sign-in can't work until the user finishes these. Their status was unknown at handoff.

1. **Google Cloud (`folder-511509`):**
   - Google Auth Platform: app name Sourcefold, External audience.
   - Data access: add the `.../auth/drive.file` scope.
   - Web client: JS origin `http://localhost:3000`; redirect URI `https://dhqrexvkinplupshqyma.supabase.co/auth/v1/callback`.
   - Audience: **Publish app**, so the status is "In production". In "Testing" mode, refresh tokens expire after 7 days.
2. **Supabase dashboard:**
   - Turn on the Google provider and paste the client ID and secret.
   - URL Configuration: Site URL `http://localhost:3000`, redirect URL `http://localhost:3000/**`.
   - Turn **off** the Email provider. Don't turn off "Allow new users to sign up"; that would block the first Google sign-in.

Check the status yourself: `curl -s "https://dhqrexvkinplupshqyma.supabase.co/auth/v1/settings" -H "apikey: <publishable key>"`. You want `external.google: true` and `external.email: false`.

Note: the existing "Web client 1" in the user's other Google project (`steam-bonbon-476707-g2`, app name "grew") belongs to a different app. Don't reuse it.

## Next steps (in order)

### 1. Unblock and verify sign-in

- [ ] Check the Supabase auth settings (command above). If Google is still off, give the user the setup steps again and wait.
- [ ] Run `npm run dev` (from the repo root). Have the user sign in at `http://localhost:3000`, then check that a row exists in `public.google_tokens` (Supabase MCP `execute_sql`: `select user_id, updated_at from google_tokens`). If there's no row, `provider_refresh_token` wasn't returned: confirm `access_type=offline` and `prompt=consent` in `features/auth/sign-in-button.tsx`.

### 2. Test what exists, then deploy

- [ ] Click through in the T3 browser preview (`preview_open` to `localhost:3000`):
  - Create, rename, nest, drag and delete folders.
  - Use keyboard navigation in the tree.
  - Paste about 5 Grokipedia links, then paste one of them again to check the duplicate message.
  - Search titles.
  - Check light and dark themes.
- [ ] Fix whatever breaks.
- [ ] Check CI: `gh run list --limit 3`. Fix failures.
- [ ] Deploy to Vercel Hobby:
  - Root directory `apps/web`, npm workspaces.
  - Env vars `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ALLOWED_EMAIL`.
  - Function region `sin1` (near the database).
- [ ] After deploy:
  - Add the Vercel URL to the Google client origins and the Supabase redirect URLs (the user may need to do the Google part).
  - Set the repo variable: `gh variable set APP_URL --body https://<app>.vercel.app`.
- [ ] From the deployed app, save one Grokipedia link to confirm Grokipedia doesn't block Vercel's IPs. If it does, plan the fallback: the extension fetches the HTML and posts it to the server.

### 3. Save to Drive (makes the core loop usable)

Decisions already made:

- **Tokens:** the server reads `google_tokens` with the **service role** (`SUPABASE_SECRET_KEY`). Add a `lib/supabase/admin.ts` client, server-only, and never import it into client code. Refresh access tokens at `https://oauth2.googleapis.com/token` with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. If the refresh fails, show "Reconnect Drive", which re-runs Google sign-in with consent.
- **Scope:** `drive.file`, so the app only sees files it created.
- **Root folder:** create a `Sourcefold` folder in Drive and store its id in `drive_state.root_folder_id`.
- **Front matter:** build it at save time with `buildFrontMatter` from `@sourcefold/core`: source, title, url, author, dates, current folder path. **`items.markdown` holds the body only.** For Grokipedia the fields are listed in SPEC section 5.
- **What needs saving:** an item or folder needs saving if `drive_synced_at is null`, or `updated_at > drive_synced_at`, or it's soft-deleted and still has a Drive id. When marking synced, set `drive_synced_at = now()` in SQL in the same statement (the `updated_at` trigger also uses `now()`, so the two values match). Setting it from a JS `Date` would leave items flagged as unsaved forever. Add an RPC such as `mark_item_synced(p_id, p_drive_file_id)`.
- **Order of operations:**
  1. Folders top-down: create, rename, move, trash.
  2. Items: create or update with a multipart upload, move, rename, trash.
  3. Deletions always go to Drive's trash, never a permanent delete.
- **Batching:** `POST /api/drive/save` handles one batch (about 20 operations) and reports `{ done, remaining }`. The client calls it until done. Mark each item synced as soon as it succeeds, so an interruption resumes cleanly.
- **File names:** `<slugify(title)>.md` (`slugify` is in core). On a clash in the same folder, append the first 6 characters of the item id.
- **UI:** the Save to Drive button lives at `features/shell/save-to-drive-button.tsx` (currently a disabled placeholder). Show the unsaved count, "Saving 12 of 40…", and the toast "Saved to Drive". Add Ctrl+S. Show the last-saved time and a Drive root link in Settings.

### 4. Then, in order: Waves 3, 4, 6, 7

See `docs/ROADMAP.md` for the checklists. Key decisions:

- **Extension auth:** the user creates a token in a new Settings page. Store a SHA-256 hash in `api_tokens`. API routes accept `Authorization: Bearer <token>`, look up the hash with the service role, and act as that `user_id` (filter by `user_id` explicitly, since RLS is bypassed). Allow CORS from the extension origin.
- **Substack:**
  - Capture runs in the extension (a content script in the user's logged-in browser).
  - Detect the paywall. Posts the user can't read return "Paid post, not saved". Paid posts they can read are saved.
  - Run `@mozilla/readability` (already a core dependency), then `htmlToMarkdown` (core). Drop images and comments.
  - Read author and publication info from JSON-LD and meta tags.
  - Detect custom-domain Substacks from the page, not the URL.
- **X:**
  - Text only: name, handle, profile URL, post URL, date (`time[datetime]`), text.
  - Read the author's own connected thread around the post.
  - Keep all selectors in one file.
  - Store the tree in `x_posts`; render it as nested blockquotes (SPEC section 5).
  - "Add to this thread" attaches more posts later.
- **Images and notes:** a Supabase Storage bucket with RLS for uploads, copied to Drive on save. Notes are `items` with `kind = 'note'`.

## How to work

The user's workflow from session 1. At the end of that session they said not to start more agents, so **confirm with the user before starting subagents in a new session.**

- **Who does what:** the orchestrator (Claude) makes every decision (architecture, libraries, naming, design) and does all non-code work (setup, migrations through the Supabase MCP, reviews, git). **Gemini 3.8 Flash (Medium)** subagents write the code, using T3 `delegate_task` with `target: { providerInstanceId: "antigravity", model: "gemini-3.8-flash-medium" }`, `runtimeMode: "full-access"`, `mode: "async"`.
- **Task size:** feature-sized (a few related files), not single files and not whole waves. Briefs are detailed: files owned, files not to touch, existing helpers and their signatures, decisions already made, exact behaviour, verification commands, and what to report.
- **Parallel agents:**
  - Give agents disjoint files.
  - Create placeholder "slot" files yourself before starting agents that import each other's components.
  - Install all dependencies yourself before starting agents. Agents must not run `npm install`, except one agent that owns a new workspace.
  - Agents never commit; the orchestrator commits with explicit paths.
- **Review every result** before committing: read the diff and run `npm run lint`, `npm run typecheck`, `npm test` and the build. Then commit and push.
- **Gemini pitfalls seen in session 1** (check for these in every review):
  - It disabled checks to get a green build (`typescript.ignoreBuildErrors`, resolver aliases).
  - Security: it accepted `next` values starting with `/`, which allowed `//evil.com`.
  - Tests passed while the output was wrong: every Grokipedia paragraph was merged into one. Write structural assertions.
  - It used `select("*")` on list queries, loading full Markdown bodies.
  - It left files unformatted despite a "run Prettier" step.
  - It used `.js` suffixes on relative imports in core.
  - Some reports were empty or vague; always read the diff.
- **Browser work:** T3 `preview_*` tools. Child agents get a separate headless browser without the user's logins, so only the orchestrator's tab or the user can do signed-in console work.

## Technical gotchas

- **Next.js 16.4:**
  - `middleware.ts` is now `src/proxy.ts`, exporting `proxy()`.
  - `params` and `searchParams` are Promises.
  - Route types (`PageProps<"/">`, `LayoutProps`) come from `next typegen`, which the `typecheck` script runs first.
  - `cacheComponents` is off on purpose.
  - `next dev` regenerates `apps/web/AGENTS.md`; keep it committed.
- **shadcn/ui "base-nova"** is built on `@base-ui/react`: use `render={...}` props, not Radix `asChild`. `cn` comes from the `cn` package (by shadcn), which is legitimate.
- **Core package:** `@sourcefold/core` is browser-safe (url, front-matter, slugify). `@sourcefold/core/server` is Node-only (linkedom, turndown, Grokipedia parser). Never import `/server` in client code. Relative imports have no file extension. `linkedom` is listed in `serverExternalPackages`.
- **Grokipedia markup:**
  - Paragraphs are `span[data-tts-block]`, converted to `<p>`.
  - Citations are `sup > a[href^="#ref-"]`, rendered as `[^N]`.
  - References are in `#references`.
  - The fact-checked date is the JSON-LD `dateModified`.
  - An honest user agent (`Sourcefold/0.1`) gets HTTP 200; missing pages return 404.
- **npm 11** blocks install scripts in this repo (expect allow-scripts warnings). The extension has no `postinstall`; its typecheck runs `wxt prepare` first.
- **OneDrive:** the repo is inside OneDrive, so installs and builds are slower. Suggest moving it if it causes problems.
- **Supabase free tier** pauses projects after about 7 days idle. Setting `APP_URL` for the keep-alive workflow fixes this once the app is deployed.

## Commands

```bash
npm run dev                         # web app on http://localhost:3000
npm run lint && npm run typecheck && npm test
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=placeholder npm run build -w @sourcefold/web
npm run build -w @sourcefold/extension   # load apps/extension/.output/chrome-mv3 as an unpacked extension
npm run format                      # Prettier; CI runs format:check
```

Regenerate database types after any migration: Supabase MCP `generate_typescript_types`, written to `apps/web/src/lib/database.types.ts`.
