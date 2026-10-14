# Sourcefold roadmap

Status as of 2026-10-14. The spec is `docs/SPEC.md`; agent rules are `AGENTS.md`; the visual system is `docs/DESIGN.md`.

## Done

- **Wave 0, setup:** spec, MIT license, public repo, CI and daily keep-alive workflows, design guide, agent rules.
- **Wave 1, foundation:**
  - Database schema with row-level security.
  - Google sign-in code with the email allow-list checked on every page.
  - App shell and design tokens.
  - Folder tree: create, rename, nest, drag to move, drag to reorder with drop indicator lines, delete, keyboard navigation (including Alt+ArrowUp/Down reordering).
  - Folder view with item rows, and title search.
  - Item actions in the folder view: rename, move to another folder, note dialog, delete (row menu).
- **Wave 2, Grokipedia:**
  - Article parser: title, summary, fact-checked date, body with paragraphs, tables and links, and every reference as a footnote.
  - `POST /api/grokipedia` with duplicate detection.
  - "Add links" paste box with sequential queue, per-link status, retry and stop.
  - Extended fixture suite: short articles without references and articles with nested lists, GFM tables, and footnotes.
- **Wave 3, Extension and Substack:**
  - Settings page in the web app: create, view and revoke extension access tokens (`api_tokens` table).
  - Bearer-token auth for API routes used by the extension (`/api/folders`, `/api/items`, `/api/capture`, etc.).
  - Extension popup: folder tree selector with last-folder memory, inline subfolder creation, duplicate warning via `/api/items/check`, and save action.
  - Substack capture: paywall detection ("Paid post, not saved" on locked content), Readability + HTML-to-Markdown, author and publication metadata extraction.
  - `POST /api/capture` endpoint handling Substack and X captures.
- **Wave 4, X:**
  - Isolated X selectors in `apps/extension/lib/x/selectors.ts` and capture extractor in `extract.ts`.
  - Capture single posts or the author's connected thread.
  - Tree storage in `x_posts`, "Add to this thread" in popup, `POST /api/x/:itemId/posts`.
  - Core X Markdown renderer with nested blockquotes per thread depth.
- **Wave 5, Save to Drive:**
  - Token refresh with Google client ID and secret via service role.
  - Drive API client with multipart file uploads, folder creation, renaming, moving and trashing.
  - Batched resumable sync (`POST /api/drive/save`), unsaved count badge, Ctrl+S keyboard shortcut, Reconnect Drive button.
  - Front matter injection at sync time via `buildFrontMatter`.
- **Wave 6, Notes and image sources:**
  - Item notes and standalone Markdown notes in folders (`POST /api/notes`, note modal).
  - Direct-to-Storage image uploads with client-side bypass of server payload limits, Supabase Storage RLS on private `images` bucket, signed link playback (`/api/items/:id/file`), Drive mirror sync.
- **Wave 7, Polish & Production:**
  - Right-click "Save link to Sourcefold" background context menu in extension.
  - Comprehensive self-hosting guide in `README.md` covering Supabase, Google Cloud, Vercel deployment, extension setup, and troubleshooting.
  - Deployed to Vercel production.
  - Daily keep-alive workflow pings `/api/health` (set the `APP_URL` repository variable).
  - All CI tests and builds passing on GitHub Actions.

- **Second audit (2026-10-14):**
  - Speed: Vercel region `sin1`, `getClaims()` auth, cached per-request client, parallel queries, loading skeletons, SQL folder counts, new indexes, no status polling, lighter client bundle.
  - Bugs fixed across core parsers, web API, UI, Drive sync and the extension (see HANDOFF.md).
  - [x] Migrations applied (without the overload drops; see HANDOFF.md), pushed, deployed, CI green.
  - [ ] Drop the four old function overloads in the SQL editor.

- **Drive and extension fixes (2026-10-14):**
  - [x] Save to Drive reports a Google OAuth client mismatch (Supabase's Google provider vs `GOOGLE_CLIENT_ID`) instead of asking to reconnect forever; Drive errors are logged.
  - [x] Extension: a page already saved in another folder can be moved with **Move here**; messages show the full folder path.
- **Open-source release (2026-10-14):**
  - [x] README rewrite (all migrations, troubleshooting), CONTRIBUTING.md, personal deployment details removed from docs.
  - [x] v0.1.0 GitHub release with the packaged extension.
- **Projects and groups (2026-10-14):**
  - [x] Top-level folders are shown as projects, with a project switcher at the top of the sidebar; folders inside a project are groups. No database change.
  - [x] The sidebar, title search, Add links picker, Move dialog and the extension's picker work per project. Project pages list their groups; groups can move between projects.
  - [ ] Deploy to Vercel and reload the extension.

## Later

- [ ] Chrome Web Store listing for the extension.
- [ ] Full-text search (title search only today).
