# Sourcefold handoff

Read this first in any new session. When the user says "continue", pick up at **Next steps** below. Keep this file current.

Last updated: 2026-10-13, after commit `67d4983` and production deployment.

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
- **CI & Build:** Clean `npm run lint`, `npm run typecheck`, vitest test suite (95 tests passing), extension build, and Next.js production build. GitHub Actions CI status is green.

## Next steps

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
