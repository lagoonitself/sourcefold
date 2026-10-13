# Sourcefold handoff

Read this first in any new session. When the user says "continue", pick up at **Next steps** below. Keep this file current.

Last updated: 2026-10-13, after commit `bb7a605`.

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

**All Core Waves (0 through 7) are fully implemented and passing all tests, typechecks, linter, and CI builds!**

- **Database:** Supabase schema with row-level security (`20261013000000_initial_schema.sql`, `20261013010000_drive_sync.sql`, and `20261013020000_image_storage.sql` applied).
- **Auth:** Google OAuth configured with offline access (`drive.file` scope) and email allowlist validation (`ALLOWED_EMAIL`).
- **Web App:** Next.js 16 (Turbopack) with folder sidebar, interactive drag reordering, Grokipedia bulk importer, item menu (rename, move, note, delete), standalone notes, direct-to-Storage image uploads, search, settings page for API token management and Drive reconnect, and Drive sync engine.
- **Extension:** WXT + React extension with folder selection, Substack parser, X thread extractor, add-to-thread, duplicate warnings, and right-click context menu save.
- **CI & Build:** Clean `npm run lint`, `npm run typecheck`, vitest test suite, extension build, and Next.js production build. GitHub Actions CI status is green.

## Next steps

1. **Paste valid `SUPABASE_SECRET_KEY` in `apps/web/.env.local`:**
   - In Supabase Dashboard -> Project Settings -> API, copy the `service_role` secret key.
   - Replace the corrupted value in `apps/web/.env.local` with the real key.
2. **Sign in locally:**
   - Open `http://localhost:3000/login` in the browser.
   - Click **Continue with Google** and authenticate with `anilreddy2569900@gmail.com`.
   - Verify folders, item uploads, and Drive sync.
3. **Deploy to Vercel:**
   - Follow the self-hosting guide in `README.md`.
