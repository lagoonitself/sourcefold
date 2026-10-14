# Sourcefold roadmap

Status as of 2026-10-13. The spec is `docs/SPEC.md`; agent rules are `AGENTS.md`; the visual system is `docs/DESIGN.md`.

## Done

- **Wave 0, setup:** spec, MIT license, public repo, CI and daily keep-alive workflows, design guide, agent rules.
- **Wave 1, foundation:**
  - Database schema with row-level security (Supabase project `sourcefold`).
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
  - Deployed to Vercel production: `https://sourcefold-eight.vercel.app`.
  - Set GitHub Actions `APP_URL` variable to `https://sourcefold-eight.vercel.app` and verified daily keep-alive workflow (`38417818515` success).
  - All CI tests and builds passing on GitHub Actions.

- **Second audit (2026-10-14):**
  - Speed: Vercel region `sin1`, `getClaims()` auth, cached per-request client, parallel queries, loading skeletons, SQL folder counts, new indexes, no status polling, lighter client bundle.
  - Bugs fixed across core parsers, web API, UI, Drive sync and the extension (see HANDOFF.md).
  - [x] Migrations applied (without the overload drops; see HANDOFF.md), pushed, deployed, CI green.
  - [ ] Drop the four old function overloads in the SQL editor.

- **Drive and extension fixes (2026-10-14):**
  - [x] Found why Drive always asks to reconnect: Supabase's Google provider uses OAuth client `716606196974-0n90lmjh…`, the app's `GOOGLE_CLIENT_ID` is `716606196974-l0c7qoeisg…`. Google rejects the refresh with `unauthorized_client`. The app now says so instead of "Reconnect".
  - [ ] Make the two clients match (see HANDOFF.md step 0a), then reconnect Drive once.
  - [x] Extension: a page already saved in another folder can now be moved with **Move here**; messages show the full folder path.

## Final Steps to Use

1. **Authorize OAuth redirect URLs:**
   - **Google Cloud Console:** add `https://sourcefold-eight.vercel.app` to **Authorized JavaScript origins** and add `https://dhqrexvkinplupshqyma.supabase.co/auth/v1/callback` to **Authorized redirect URIs**.
   - **Supabase Dashboard:** under **Authentication** → **URL Configuration**, set **Site URL** to `https://sourcefold-eight.vercel.app` and add `https://sourcefold-eight.vercel.app/**` to **Redirect URLs**.
2. **Sign in:**
   - Open `https://sourcefold-eight.vercel.app/login` (or `http://localhost:3000/login` locally) and click **Continue with Google** using `anilreddy2569900@gmail.com` to grant Google Drive sync access.
