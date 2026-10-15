# Sourcefold roadmap

Status as of 2026-10-15. The spec is `docs/SPEC.md`; agent rules are `AGENTS.md`; the visual system is `docs/DESIGN.md`.

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
  - Isolated X selectors in `apps/extension/lib/x/selectors.ts` and capture extractor in `extract.ts`.\n - Capture single posts or the author's connected thread.
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
  - [x] Top-level folders are shown as projects, with a project switcher at the top of the sidebar; folders inside a project are groups.
  - [x] The sidebar, title search, Add links picker, Move dialog and the extension's picker work per project. Project pages list their groups; groups can move between projects.
  - [x] Projects are isolated; a link is unique per group, so it can sit in several groups and several projects. Sources only live in groups (database trigger).
  - [x] Migration applied to the owner's database; pushed to `main`.
  - [ ] Confirm the Vercel deploy and reload the extension.
- **Copy links (2026-10-14):**
  - [x] Checkboxes on a group's sources and a Copy links button (all, or only the ticked ones).

- **Content lives in Drive (2026-10-14):**
  - [x] Supabase keeps links and metadata only; article text and images are cleared once their Drive copy exists (`mark_item_stored_in_drive`).
  - [x] New sources are pushed to Drive automatically right after saving.
  - [x] Renames and moves rebuild the file from its Drive copy; images open from Drive.
  - [x] Migration applied to the owner's database.
  - [ ] Confirm on the live app (see HANDOFF.md).
- **Archive projects (2026-10-14):**
  - [x] Archive and Unarchive in the project menu; archived projects are listed separately and hidden from pickers, the extension and search across projects.
  - [x] Migration applied to the owner's database.
  - [ ] Confirm on the live app.

- **Desktop app (Wave 8, 2026-10-15):**
  - [x] Tauri v2 desktop application scaffold with React 19, Tailwind CSS v4, and Rust backend (`apps/desktop`) for Windows and macOS.
  - [x] Dual-mode architecture: signed-in mode (web API token) and offline mode (embedded SQLite `sourcefold.db`).
  - [x] Browser loopback sign-in flow (`/desktop/connect` on web, temporary loopback listener on desktop, session stored in `session.json`).
  - [x] Background sync on window focus and every 30 seconds in signed-in mode.
  - [x] Local integration surface: HTTP loopback server on `127.0.0.1:23456` and Chrome Native Messaging host (`com.sourcefold.native`).
  - [x] Local security controls: Host and Origin checks, no CORS wildcard, `/api/session` restricted to extension.
  - [x] Extension auto-target resolution (desktop signed in -> web API, desktop offline -> local SQLite, fallback -> configured web app).
  - [x] Keyboard-first desktop UI with single shortcut registry, command palette (`Mod+K`), reader view (`Enter`), and shortcuts cheat sheet (`?`).
  - [x] Web API routes accept Bearer token via `requireApiUser` with admin client and explicit `user_id` filtering.
  - [x] Desktop group view matches the web's: header (breadcrumb, serif title, source count, New subgroup / Add image / New note), Select mode and Copy all links, subgroup rows, and source rows with a colored type bar, type icon, source name, saved date and status check. Add image works offline (`add_image`) and signed in (`POST /api/uploads/sign`, signed Storage upload, `POST /api/uploads`); signed-in images open via `GET /api/items/[id]/file?format=json`. [ ] Not yet tried against the live Supabase Storage.
  - [ ] Owner's hands-on test of desktop sign-in and sync.
  - [ ] Owner's hands-on test of the desktop group view (see HANDOFF).
  - [ ] Extension test against desktop signed-in and offline modes.
  - [ ] First macOS CI run.
  - [ ] First desktop release.
  - [ ] Code signing (not planned, $0 budget).
  - [ ] Optional: import an offline library into the account.
  - [ ] Item reordering in desktop (no API yet).
  - [ ] Offline duplicate check per group: offline `check_url` still treats a link as a duplicate across all groups; the spec says once per group.
  - [ ] Wire `uninstall_native_host` to a desktop Settings button; the function exists but nothing calls it.
  - [ ] Drop the seeded offline "Inbox" project / "General" group once the server tests stop depending on their fixed IDs.

## Later

- [ ] Chrome Web Store listing for the extension.
- [ ] Full-text search (title search only today).
