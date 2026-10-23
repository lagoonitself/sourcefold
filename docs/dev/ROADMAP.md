# Sourcefold roadmap

Status as of 2026-10-15. The spec is `docs/dev/SPEC.md`; agent rules are `AGENTS.md`; the visual system is `docs/dev/DESIGN.md`.

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
  - Bugs fixed across core parsers, web API, UI, Drive sync and the extension (see docs/dev/HANDOFF.md).
  - [x] Migrations applied (without the overload drops; see docs/dev/HANDOFF.md), pushed, deployed, CI green.
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
  - [ ] Confirm on the live app (see docs/dev/HANDOFF.md).
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
  - [x] Substack in the desktop app (method ported from sbstck-dl, MIT): paste post links or a whole publication (archive API, sitemap fallback, optional date range), paid posts with the user's `substack.sid` cookie stored on this computer only, rate limiting with Retry-After. Saves through `capture`, so signed-in saves sync to the web and Drive. The shared extractor now reads Substack's embedded post data first, which the extension also uses.
  - [x] Substack images (2026-10-15): kept as Markdown images pointing at the original upload, with captions; galleries keep every image. The page-based fallback uses the same converter. Each post's images are also saved in `<Title>_files/` next to it, in Drive and in the local copy (local links point at the saved files). [ ] Offline mode still links to the web.
  - [x] Signed-in desktop keeps a local copy of the library in the storage folder, same layout as Drive (`GET /api/mirror`, `GET /api/items/[id]/content`, `local_copy.rs`). [ ] Needs the web app deployed, then the owner's check.
  - [x] Reader works signed in and offline for every text source (loads the file from the web app or the local DB, hides front matter, footnotes, inline images, safe links). [ ] Owner's check.
  - [x] Wikipedia source type (web, desktop signed in and offline), migration `20261015000000_wikipedia_kind.sql`. [x] Migration applied (2026-10-16). [ ] Owner's check.
  - [x] More source types (2026-10-16): YouTube transcripts (videos, playlists and channels on desktop; videos in the extension), any web page (defuddle), PDFs and arXiv (pdf.js, arXiv HTML), Reddit, Hacker News and Bluesky threads. Shared extractors in `packages/core`, `POST /api/source` on the web, Rust `web_fetch` on desktop, page capture in the extension; migration `20261016000000_more_source_kinds.sql`. [x] Migration applied (2026-10-16). [ ] Owner's check.
  - [x] YouTube transcripts in English only (2026-10-17): AI-dubbed videos list an auto-generated track per dubbed language, and the old picker saved the first by name (Arabic). Now the original audio's English track, else machine-translated (`captions: translated`, often refused by YouTube). Desktop Add links leaves 2–5 s between videos and waits 1 then 3 minutes on a rate limit before failing. [ ] Owner re-saves the six affected videos.
  - [x] Google Doc next to every Markdown file in Drive; `.docx` in the desktop's local copy. [ ] Owner's check of how Drive renders the import.
  - [x] Desktop redesign "ink and highlighter" (2026-10-18, branch `desktop-redesign`): new tokens, bundled Geist and Newsreader, motion, responsive shell (sliding sidebar, top bar with search, Drive status and Add links), macOS overlay title bar, new icon, every screen restyled. [ ] Owner's check, then merge to `main`.
  - [ ] Owner's hands-on test of Substack saving on desktop (free post, publication import, paid post with cookie).
  - [ ] Owner's hands-on test of desktop sign-in and sync.
  - [ ] Owner's hands-on test of the desktop group view (see HANDOFF).
  - [ ] Extension test against desktop signed-in and offline modes.
  - [x] First macOS CI run (green 2026-10-16).
  - [x] First desktop release: v0.2.0 (2026-10-16), Windows and macOS installers and the extension zip in one GitHub Release with an install guide. [ ] Owner's check.
  - [x] README lists every supported source, with which sites need the extension (2026-10-16).
  - [x] Extension popup redesign (2026-10-17): the project stays put between saves (one project per video) with a full-width switcher, the project's groups as a list, New project / New group inline, source-type mark and bundled fonts. Faster: paints from a cache at once, asks the desktop app over native messaging and HTTP at the same time, and runs the page capture while the popup is open. [ ] Owner's check.
  - [x] Open the deployment to friends: `ALLOWED_EMAIL=*`, `publicFetch` guard on server-side fetches of pasted links.
  - [ ] Code signing (not planned, $0 budget).
  - [ ] Optional: import an offline library into the account.
  - [ ] Item reordering in desktop (no API yet).
  - [ ] Offline duplicate check per group: offline `check_url` still treats a link as a duplicate across all groups; the spec says once per group.
  - [ ] Wire `uninstall_native_host` to a desktop Settings button; the function exists but nothing calls it.
  - [ ] Drop the seeded offline "Inbox" project / "General" group once the server tests stop depending on their fixed IDs.

- [x] Tidy files (2026-10-15): one layout and Markdown format for Drive and desktop disk, written down in `docs/FILE-FORMAT.md`.
  - [x] Readable names: `Sourcefold/<Project>/<Group>/<Title>.md`, real folder names, `Title (2)` on clashes, no random IDs.
  - [x] One builder per app (`packages/core` `buildItemFile`, desktop `build_item_file`), checked against shared golden files in `packages/core/test/golden/`.
  - [x] Desktop renames, moves and deletes now follow on disk; folder delete only removes Sourcefold's own files and empty folders.
  - [x] Rust tests no longer write into the real `Documents/Sourcefold`.
  - [ ] Owner checks a real Grokipedia save in Drive and in desktop offline mode.

- **Reader, highlights and search (planned 2026-10-17, `docs/dev/PLAN-reader-search.md`):**
  - [x] Phase 1 (built 2026-10-17, migration applied; [ ] owner's check): highlights in the desktop reader (select to highlight, notes, copy with source, YouTube timestamps, Grokipedia and Wikipedia references kept), side panel, cited sources saved to a group, next/previous source, group Highlights tab with Copy with sources. `highlights` table in Supabase and SQLite.
  - [x] Phase 2 (built 2026-10-18, contract `docs/dev/handoff-search.md`; [ ] web deploy, [ ] owner's check): keyword search inside every source (SQLite FTS5 over passages from the local copy or offline storage), one index file per project, "This project" / "All projects" on `Tab`, results open the reader at the passage with the words marked, `Mod+F` find in the reader.
  - [x] Phase 3, text part (built 2026-10-18, same contract; [ ] owner's check): search by meaning on this computer with EmbeddingGemma 2 (WebGPU, WASM fallback), merged with keyword results by Reciprocal Rank Fusion, off until turned on in Settings → Search.
  - [ ] Phase 3, rest: images inside sources, **Find in other sources** (`f`) on a highlight.
  - [ ] Serve the ONNX Runtime files from the app instead of `cdn.jsdelivr.net` (set `env.backends.onnx.wasm.wasmPaths`), and drop the unused 27 MB asyncify `.wasm` from the build.

- **Remove text from a saved source (built 2026-10-19; [ ] owner's check):**
  - [x] Desktop reader "Remove text" mode (`e`): select text then **Remove** / `Backspace`, or the trash button beside a block; **Edit as text**; Undo toast and `z`. `removeFromBody` and the `data-sf-src` source map are in `packages/core/src/reader`.
  - [x] Saving: `PATCH /api/items/[id]` takes `markdown` for text sources and starts a Drive push (Doc and local copy follow); offline, the `update_item_body` command rewrites the file on disk.
  - [x] Claude can do it too: `remove_text` (a quote or a whole section) and `undo_remove_text` in the MCP server.
  - [ ] Not covered: the footnote/reference list at the end (use **Edit as text**), parts of a table, quote or multi-line list item (whole block only), X threads, the web app (it has no reader).

- **Sourcefold for Claude, MCP server (built 2026-10-19, contract `docs/dev/handoff-mcp.md`; [ ] owner's check in Claude Desktop):**
  - [x] `apps/mcp`: 26 tools over the web API (browse, read in parts, find, organize, notes, highlights on the reader's own text, add links as background jobs with YouTube pacing, images, Drive, show in app), packed as `Sourcefold-Claude.mcpb`.
  - [x] Desktop bridge: `agent.json` key and `/api/agent/*` (status, keyword search, show, changed, Substack fetch); Settings → Claude → Add to Claude Desktop; live refresh and "show in app".
  - [x] Release workflow builds the bundle, ships it inside the desktop installers and as a fourth download.
  - [x] Fixes from Claude Desktop's own test run (2026-10-19): browse level by level (groups, then titles, then a source's outline and only the sections needed), a `project` guard on every change, footnote markers in highlight quotes, Wikimedia image downloads, waiting for a Drive save already running, clear messages for listing pages, and no more empty "saved" sources.
  - [ ] Owner re-tests the moves, deletes and archives Claude's safety check skipped, using the `project` guard.
  - [x] PDFs from Claude Desktop (2026-10-19): every non-arXiv PDF failed with `No "GlobalWorkerOptions.workerSrc" specified`; the MCP now hands pdf.js its worker module. [ ] Owner re-adds a failed PDF.
  - [x] Research tools from the owner's research run (2026-10-19, branch `research-tools`, contract `docs/dev/handoff-research.md`): keep/maybe/cut status and outline tags, a short summary per source, quote cards and an outline, a script view with citations and a reference list, duplicates across groups (refused on save, merged in a Duplicates view), author and author type per source, a b-roll list of video timestamps. Web API, desktop (signed in and offline), file format and nine MCP tools. Migration `20261019000000_research_tools.sql` applied, merged and deployed (2026-10-21). [ ] Owner tests.
  - [x] Fixes from the 800-source run (2026-10-20, branch `mcp-run-fixes`, `docs/dev/handoff-run-fixes.md`): the server crash (Node's fetch assert; pages now fetched over HTTP/2 with Chrome's headers), add jobs kept on disk and resumed, queue position, per-link time limit, Drive autosave, short ids, compact project tree, `move_sources if_duplicate`, bot-wall detection, main-text fallback, clearer network errors, arXiv HTML without a title. [ ] Owner reinstalls the bundle and re-runs the failed links; merge.
  - [x] Photos and GIFs in saved X posts (2026-10-21, branch `x-media`, `docs/dev/handoff-x-media.md`): media from X's embed service or FxTwitter, saved into `<Title>_files/` in Drive and the local copy, GIFs as MP4 (first frame in the Google Doc, playing in the reader), videos linked only. Migration `20261021000000_x_post_media.sql` applied. [ ] Merge, deploy, owner tests.
  - [ ] A real-browser fallback for sites that still refuse (Decrypt, TheStreet, Tesla, OUP, Technical.ly, Bloomberg, Reuters, APA): the desktop app's webview or the Chrome extension.
  - [ ] Dropped by the owner for now (2026-10-19): X posts through Claude (X's public embed data).
  - [ ] Offline mode (the desktop's local library) through the bridge.
  - [ ] Search by meaning for Claude (the query vector comes from the app's GPU worker).
  - [ ] Optional: a remote MCP server on Vercel for Claude on the phone and claude.ai (no YouTube adding, no search inside sources).

- **Tidy repository and v0.3.0 release (2026-10-18):**
  - [x] README rewritten for users first (downloads, features, which part does what, supported sources); setup moved to `docs/SELF-HOSTING.md`, install steps to `docs/INSTALL.md`, developer docs to `docs/dev/`.
  - [x] `CHANGELOG.md`; the release workflow puts the tagged version's section in the notes and refuses to release without one.
  - [x] Releases carry three fixed-name files (`Sourcefold-Windows-Setup.exe`, `Sourcefold-Mac.dmg`, `Sourcefold-Chrome-Extension.zip`), so `releases/latest/download/…` links always work.
  - [ ] Owner checks the release downloads on Windows and a friend's Mac.

## Next: desktop first (the website becomes optional)

Contract: `docs/dev/handoff-no-website.md`. Comes before phase 2 of sharing.

- [x] Step 1: Supabase groundwork. RLS audit (nothing to grant), Edge Function `google-access-token` deployed, sign-up allow list migration applied, GitHub variables set, owner set the secrets (2026-10-23). Owner: redirect URLs if not done, turn on the hook.
- [x] Step 2: the website's API running inside the app and extension from `packages/client` (2026-10-23). The code moved rather than being copied: the website's routes are thin wrappers around the same handlers; `createLocalApi` routes 29 paths plus health, with Drive pushes in-process.
- [ ] Step 3: desktop signs in with Google through Supabase, uses the local API, pushes to Drive itself, local copy without the website.
- [ ] Step 4: extension uses the desktop app's sign-in or its own.
- [ ] Step 5: Claude starts the desktop app in the background instead of using the website.
- [ ] Step 6: release variables, README, INSTALL and SELF-HOSTING with the website optional.

## Next: project files and shared projects

Plan: `docs/dev/PLAN-sharing.md` (2026-10-22).

- [x] Phase 1: project file. Download and import a `.sourcefold` file on the website and the desktop app (signed in and offline); manifest builder in `packages/core` with golden files. Built 2026-10-23 on `project-files`; waiting for the owner's test, then merge and deploy.
- [ ] Phase 2: sharing foundation. Members and invites, `project_id` on rows, new database rules, every token route and database function checked for membership, R2 storage for shared projects with a 9.5 GB stop, Share dialog, "Shared" in the website, desktop, extension and Claude.
- [ ] Phase 3: live updates (Supabase Realtime on the website, the desktop's choice after a test), "changed while you were editing" checks, who added each source.
- [ ] Phase 4: history panel, Undo per change, source versions in the reader.
- [ ] Phase 5: shared projects in each member's own Drive.

## Later

- [ ] Chrome Web Store listing for the extension ($5 one-time fee; the store build must drop the manifest `key`, and the desktop native host must also allow the store's extension ID).
- [ ] Register the native messaging host for Brave too (macOS and Linux keep their own `BraveSoftware/Brave-Browser/NativeMessagingHosts` folder; the local HTTP fallback works meanwhile).
- [ ] Save a whole blog at once from its RSS feed or sitemap, picking posts like a YouTube playlist.
- [ ] Pasted links for pages that build their text with JavaScript (DeepMind, Meta AI): render them in a hidden desktop window first. The extension already handles them.
- [ ] More dedicated sources: GitHub (README, issues, PRs), Semantic Scholar, PubMed, bioRxiv, OpenReview, Stack Overflow, Threads, Mastodon, podcast transcripts.
- [ ] Speech-to-text (Whisper) for YouTube videos without captions.
