# Sourcefold roadmap

Status as of 2026-10-13. Work paused here. The spec is `docs/SPEC.md`; agent rules are `AGENTS.md`; the visual system is `docs/DESIGN.md`.

## Done

- **Wave 0, setup:** spec, MIT license, public repo, CI and daily keep-alive workflows, design guide, agent rules.
- **Wave 1, foundation:**
  - Database schema with row-level security (Supabase project `sourcefold`).
  - Google sign-in code with the email allow-list checked on every page.
  - App shell and design tokens.
  - Folder tree: create, rename, nest, drag to move, delete, keyboard navigation.
  - Folder view with item rows, and title search.
- **Wave 2, Grokipedia:**
  - Article parser: title, summary, fact-checked date, body with paragraphs, tables and links, and every reference as a footnote. Tested against a saved real page.
  - `POST /api/grokipedia` with duplicate detection.
  - "Add links" paste box with per-link status, retry and stop.
- **Wave 3 groundwork:** Chrome extension skeleton (popup, settings page with "Test connection", right-click menu entry), and `POST /api/items/check` for duplicate checks.

## Your setup steps (blocking sign-in)

1. **Google Cloud project `sourcefold` (`folder-511509`):**
   - Google Auth Platform: app name Sourcefold, External audience.
   - Data access: add the `.../auth/drive.file` scope.
   - Web client: origin `http://localhost:3000`; redirect URI `https://dhqrexvkinplupshqyma.supabase.co/auth/v1/callback`.
   - Audience: Publish app, so the status is "In production".
2. **Supabase:**
   - Turn on the Google provider and paste the client ID and secret.
   - URL Configuration: Site URL `http://localhost:3000`, redirect URL `http://localhost:3000/**`.
   - Turn off the Email provider.
3. **Check:** run `npm run dev`, open `http://localhost:3000`, sign in with the allowed account, and confirm a row appears in the `google_tokens` table.

## Remaining work

### Finish waves 1 and 2

- [ ] End-to-end check after sign-in: create folders, paste 40 Grokipedia links, search titles.
- [ ] Deploy to Vercel (free Hobby plan):
  - Set the env vars `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `ALLOWED_EMAIL`.
  - Add the Vercel URL to the Google client origins and to the Supabase redirect URLs.
  - Set the GitHub repository variable `APP_URL` so the keep-alive workflow runs.
- [ ] Confirm Grokipedia is reachable from Vercel's servers. If it's blocked, fetch through the extension instead (SPEC section 3).
- [ ] Confirm the GitHub Actions CI run passes on `main`.
- [ ] Item actions in the folder view: rename, move to another folder, delete (row menu).
- [ ] Folder reordering by drag. Only moving into another folder exists today.
- [ ] Add two or three more Grokipedia fixtures (lists, tables, short articles) to harden the parser.

### Wave 3: extension and Substack

- [ ] Settings page in the web app: create and revoke extension access tokens (`api_tokens` table exists).
- [ ] Bearer-token auth for API routes used by the extension. This needs `SUPABASE_SECRET_KEY` on the server; look up `token_hash` and act as that user.
- [ ] Extension popup:
  - Load folders, default to the last-used one, allow creating a new one.
  - Save button, with a duplicate warning via `/api/items/check`.
- [ ] Substack capture (content script):
  - Detect the paywall and report "Paid post, not saved" for posts you can't read.
  - Run Readability, then `htmlToMarkdown` from core; drop images and comments.
  - Read author and publication metadata.
  - Detect custom-domain Substacks from the page itself.
- [ ] `POST /api/capture` for extension-captured content.
- [ ] Switch the extension's local `page-type.ts` to `detectSource` from `@sourcefold/core`.

### Wave 4: X

- [ ] Content script that reads the post you're viewing plus the author's own thread: text, name, handle, profile link, post link, date. Keep all selectors in one file.
- [ ] Store threads as a tree in `x_posts`; add "Add to this thread" in the popup; `POST /api/x/:itemId/posts`.
- [ ] X Markdown renderer in core, with nested blockquotes per level (SPEC section 5).

### Wave 5: Save to Drive

- [ ] Refresh Google access tokens with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, reading `google_tokens` with the service role. Show "Reconnect Drive" if the refresh fails.
- [ ] Mirror folders in Drive under a `Sourcefold` root: create, rename, move, trash.
- [ ] Mirror files: create, update, move, rename, trash. Name files `<title-slug>.md`, adding a short id when two would clash.
- [ ] Build front matter at save time with `buildFrontMatter` (source, URL, author, dates, current folder path). The database stores bodies only.
- [ ] Save in resumable batches (`POST /api/drive/save` called until done); add the Ctrl+S shortcut and the unsaved count on the button.
- [ ] Set `drive_synced_at` with SQL `now()` in the same update as the Drive id, so an item doesn't stay marked "unsaved" forever.

### Wave 6: notes and your own sources

- [ ] A note box on every item, and standalone Markdown notes in folders.
- [ ] Image uploads: a Supabase Storage bucket with row-level security; copy images to Drive on save.

### Wave 7: polish

- [ ] Right-click "Save link to Sourcefold" (the background handler is a stub) and a keyboard shortcut.
- [ ] Review error and empty states across the app and extension.
- [ ] Self-hosting guide in the README (Supabase, Google Cloud, Vercel), plus screenshots.

## Known issues and tech debt

- The repo sits inside OneDrive, which slows installs and builds. Consider moving it to a folder outside OneDrive.
- Two similar folder-path helpers exist (`features/folders/tree.ts` and `features/items/folder-paths.ts`); merge them.
- Some API errors return raw database messages; map them to user-facing text.
- `apps/web/tsconfig.json` doesn't extend `tsconfig.base.json`, so `noUncheckedIndexedAccess` is off in the web app.
- npm 11 warns about blocked install scripts (`unrs-resolver`); review with `npm approve-scripts`.
- Supabase's free tier pauses projects after about a week idle. This stays a risk until the app is deployed and `APP_URL` is set for the keep-alive workflow.
