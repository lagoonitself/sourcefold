# Sourcefold handoff

Read this first in any new session. When the user says "continue", pick up at **Next steps** below. Keep this file current.

This repo is public. Don't put account emails, project IDs, client IDs or other deployment details here; keep them in the agent's private memory.

Last updated: 2026-10-14, after adding projects and groups.

## What we're building

Sourcefold is an open-source (MIT), self-hosted research source collector. The owner collects sources for YouTube video research and feeds them into NotebookLM, Gemini and other tools.

- **Sources:** Grokipedia articles (bulk-paste 30–40 links), Substack posts (free posts, plus paid posts the user subscribes to), and X posts (text only, threads kept as a tree).
- **Format:** every source is stored as clean Markdown.
- **Organizing:** projects (for example "Cars", "Bikes"), each with its own groups inside groups, unlimited depth. A project is a top-level folder and a group is a folder inside one; the UI shows one project at a time. Each item lives in one group. Drag-and-drop to reorder or nest.
- **Reading:** clicking an item opens the original page (or signed link for uploaded images). The app never shows the content itself.
- **Drive:** one **Save to Drive** button (and Ctrl+S) mirrors the folders and `.md` files into the user's Google Drive.
- **Chrome extension:** saves the page you're viewing into a chosen folder in one click.
- **Constraints:** $0 budget (free tiers only), desktop web app, single user per deployment (`ALLOWED_EMAIL`), search by title only.

| File                             | What it holds                                                               |
| -------------------------------- | --------------------------------------------------------------------------- |
| `README.md`                      | What it is, self-hosting setup, troubleshooting                             |
| `CONTRIBUTING.md`                | How to contribute                                                           |
| `docs/SPEC.md`                   | Product and technical spec: data model, Markdown formats, API, waves        |
| `docs/DESIGN.md`                 | Visual system (tokens, fonts, layout, copy rules); every UI task follows it |
| `docs/ROADMAP.md`                | Checklist of done and remaining work                                        |
| `AGENTS.md`                      | Rules every coding agent follows                                            |
| `docs/open-source-references.md` | Projects to borrow from (Substack and X capture)                            |

## Current state

All waves (0 through 7) are built, tested and deployed. The owner's deployment works end to end: extension saves, bulk add, and Save to Drive.

- **Stack:** Next.js 16 on Vercel, Supabase (Postgres with RLS, Auth with Google, Storage), WXT + React Chrome extension, Google Drive API (`drive.file` only).
- **Checks:** `npm run format:check`, `lint`, `typecheck`, 106 Vitest tests, and the web and extension builds all pass in CI.
- **Release:** v0.1.0 on GitHub with the packaged extension zip.

Lessons worth keeping:

- The Google OAuth client in Supabase's Google provider must be the same client as the app's `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Otherwise Google refuses the token refresh with `unauthorized_client`, and reconnecting can never fix it. The app now reports this case directly.
- A folder lists only its own items, not its subfolders' items. Users may think a save failed; the extension now shows the full folder path and offers **Move here** for pages saved elsewhere.
- The Supabase MCP won't run `drop function`, and dropping needs the user's confirmation.
- A project is a top-level folder and a group is a folder inside one, so Drive mirrors `Sourcefold/<Project>/<Group>/…`. Migration `20261014010000_projects_and_groups.sql` makes links unique per group (`items_folder_canonical_url_key`), rejects sources saved directly in a project, and stops a group with sources from becoming a project. Projects share nothing: search, duplicate checks and recent X threads are scoped to one project.
- Local `npm run dev` uses the live Supabase project, so don't create or delete test data there without asking.

## Next steps

1. **Deploy projects and groups.** Apply `supabase/migrations/20261014010000_projects_and_groups.sql` to the owner's database (the MCP apply was declined on 2026-10-14; run it in the SQL editor or approve it), push to `main` so Vercel deploys, then rebuild the extension (`npm run build -w @sourcefold/extension`) and reload it in Chrome. The owner's test data was soft-deleted on 2026-10-14; the next Save to Drive trashes its Drive copies.
2. **Optional cleanup on the owner's database: drop the old function overloads.** Older migrations were applied through the MCP, which couldn't drop the old signatures, so they still exist next to the new ones. The app always passes `p_user_id`, so they're unused. Fresh installs from `supabase/migrations/` don't have this problem. Run once in the Supabase SQL editor:

   ```sql
   drop function if exists public.soft_delete_folder(uuid);
   drop function if exists public.drive_dirty_folders();
   drop function if exists public.drive_dirty_items(integer);
   drop function if exists public.drive_unsaved_count();
   ```

3. **Ideas for later** (none started): Chrome Web Store listing for the extension, full-text search, more source types. Ask the owner before starting any of these.
