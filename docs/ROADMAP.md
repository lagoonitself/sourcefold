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
- **Wave 7, Polish:**
  - Right-click "Save link to Sourcefold" background context menu in extension.
  - Comprehensive self-hosting guide in `README.md` covering Supabase, Google Cloud, Vercel deployment, extension setup, and troubleshooting.
  - All CI tests and builds passing on GitHub Actions.

## Current Setup & Verification Steps

1. **Fix `SUPABASE_SECRET_KEY` in `apps/web/.env.local`:**
   - In Supabase Dashboard -> Project Settings -> API, copy the `service_role` secret key.
   - Paste it as `SUPABASE_SECRET_KEY=<your_service_role_key>` in `apps/web/.env.local`.
2. **Sign in locally:**
   - With `npm run dev` running, open `http://localhost:3000/login` and click **Continue with Google** using `anilreddy2569900@gmail.com`.
   - Verify that Google refresh token is saved in `public.google_tokens`.
3. **Deploy to Vercel (free Hobby plan):**
   - Connect repo `lagoonitself/sourcefold` with Root Directory `apps/web`.
   - Set environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ALLOWED_EMAIL`, `SUPABASE_SECRET_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
   - Add Vercel domain to Google OAuth origins and Supabase redirect URLs.
   - Set GitHub repository variable `APP_URL` to enable daily keep-alive ping.
