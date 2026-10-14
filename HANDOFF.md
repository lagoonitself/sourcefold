# Sourcefold handoff

Read this first in any new session. When the user says "continue", pick up at **Next steps** below. Keep this file current.

Last updated: 2026-10-14, after diagnosing the Drive OAuth client mismatch and adding "Move here" to the extension.

## What we're building

Sourcefold is a personal, open-source (MIT) research source collector. The user collects sources for YouTube video research and feeds them into NotebookLM, Gemini and other tools.

- **Sources:** Grokipedia articles (bulk-paste 30–40 links), Substack posts (free posts, plus paid posts the user subscribes to), and X posts (text only, threads kept as a tree).
- **Format:** every source is stored as clean Markdown.
- **Organizing:** folders inside folders, unlimited depth. Each item lives in one folder. Drag-and-drop to reorder or nest.
- **Reading:** clicking an item opens the original page (or signed link for uploaded images). The app never shows the content itself.
- **Drive:** one **Save to Drive** button (and Ctrl+S) mirrors the folders and `.md` files into the user's Google Drive.
- **Chrome extension:** saves the page you're viewing into a chosen folder in one click.
- **Constraints:** $0 budget (free tiers only), desktop web app, single user per deployment (`ALLOWED_EMAIL`), search by title only.

Full detail:

| File                             | What it holds                                                               |
| -------------------------------- | --------------------------------------------------------------------------- |
| `docs/SPEC.md`                   | Product and technical spec: data model, Markdown formats, API, waves        |
| `docs/DESIGN.md`                 | Visual system (tokens, fonts, layout, copy rules); every UI task follows it |
| `docs/ROADMAP.md`                | Checklist of done and remaining work                                        |
| `AGENTS.md`                      | Rules every coding agent follows                                            |
| `docs/open-source-references.md` | Projects to borrow from (Substack and X capture)                            |

## Current state

**All Core Waves (0 through 7) are fully implemented, tested, and deployed!**

- **Database:** Supabase schema with row-level security (`20261013000000_initial_schema.sql`, `20261013010000_drive_sync.sql`, and `20261013020000_image_storage.sql` applied).
- **Production Deployment:** Live on Vercel at **`https://sourcefold-eight.vercel.app`**.
- **Keep-Alive:** Configured `APP_URL` repository variable on GitHub. Daily keep-alive workflow pings `/api/health` to keep Supabase free tier active (`38417818515` verified).
- **Auth:** Google OAuth configured with offline access (`drive.file` scope) and email allowlist validation (`ALLOWED_EMAIL`).
- **Web App:** Next.js 16 (Turbopack) with folder sidebar, interactive drag reordering, Grokipedia bulk importer, item menu (rename, move, note, delete), standalone notes, direct-to-Storage image uploads, search, settings page for API token management and Drive reconnect, and Drive sync engine.
- **Extension:** WXT + React extension with folder selection, Substack parser, X thread extractor, add-to-thread, duplicate warnings, and right-click context menu save.
- **CI & Build:** Clean `npm run lint`, `npm run typecheck`, vitest test suite (106 tests passing), extension build, and Next.js production build. GitHub Actions CI status is green.

**Second audit (2026-10-14):** six Gemini auditors, then six fixers, all reviewed. Speed: Vercel region moved to `sin1`, local JWT checks with `getClaims()` instead of `getUser()` network calls (one per request, cached with React `cache`), parallel page queries, `loading.tsx` skeletons, folder counts via SQL (`folder_item_counts`), no 30 s Drive status polling, dialogs mount only when open, smaller client bundle. Bugs: notes no longer wiped by refresh, Ctrl+S no longer starts a Drive sync while typing, moved folders land at the end, Drive sync items no longer stuck forever, Drive rate-limit retries, UTF-8 uploads, save lock against duplicate Drive folders, X reply duplicate check, URLs with parentheses kept intact, extension "Add to thread" attaching the wrong post, extension asked for `<all_urls>` (now removed).

## Next steps

0a. ~~Fix Google Drive OAuth client mismatch~~ **Done 2026-10-14.** The app's `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (Vercel, all environments, and `.env.local`) now use the same client Supabase signs in with, `716606196974-0n90lmjh1teovlq475oev6offl5f83uc`. The stored refresh token was tested against Google and the Drive API after the change and works; production redeployed. If Drive ever says the client doesn't match again, these two places have drifted apart.

   Also learned: the extension did save the Wikipedia article (160 KB of Markdown) into `imp / akjdb`. Parent folders don't list items from subfolders, which made it look missing.

0. **Optional cleanup: drop the old function overloads.** The second-audit SQL is live (applied 2026-10-14 through the Supabase MCP, functions run in `sin1`). The MCP refuses `drop function`, so the old signatures still exist next to the new ones. The app always passes `p_user_id`, so they are unused. Run this once in the Supabase SQL editor:

   ```sql
   drop function if exists public.soft_delete_folder(uuid);
   drop function if exists public.drive_dirty_folders();
   drop function if exists public.drive_dirty_items(integer);
   drop function if exists public.drive_unsaved_count();
   ```

   Until then, any RPC call to those four functions that leaves out `p_user_id` fails as ambiguous.

1. **Authorize OAuth redirect URLs:**
   - In **Google Cloud Console** (project `folder-511509`): add `https://sourcefold-eight.vercel.app` to **Authorized JavaScript origins**.
   - In **Supabase Dashboard** (`dhqrexvkinplupshqyma`): under **Authentication** → **URL Configuration**, set **Site URL** to `https://sourcefold-eight.vercel.app` and add `https://sourcefold-eight.vercel.app/**` to **Redirect URLs**.
2. **First-time sign in:**
   - Visit `https://sourcefold-eight.vercel.app/login` (or `http://localhost:3000/login` locally) and click **Continue with Google** using `anilreddy2569900@gmail.com`.
   - Grant the Google Drive access consent.
3. **Install & connect Chrome extension:**
   - Run `npm run build -w @sourcefold/extension`.
   - In Chrome (`chrome://extensions`), turn on Developer mode and click "Load unpacked" on `apps/extension/.output/chrome-mv3`.
   - Open Settings in Sourcefold, generate a token, and connect the extension.
