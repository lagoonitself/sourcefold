# Sourcefold spec

Version 1, 2026-10-13. Source of truth for what we build. Decisions here came from the Q&A on the original Notion page ("scraper and collector").

## 1. Goal

A personal, open-source research tool. Save sources from Grokipedia, Substack and X into folders, keep each source as clean Markdown, and push everything to Google Drive with one button. The Markdown goes into NotebookLM, Gemini and other tools for research and YouTube video prep.

Later (not in scope now): a public website per video where every claim links to its source.

### Non-goals (v1)

- Reading sources inside the app. Clicking an item opens the original page.
- Search beyond titles. No full-text or embedding search.
- Mobile apps or phone capture.
- Images or video from X.
- Paid Substack posts you do not subscribe to.
- Re-scraping or versioning Grokipedia articles.
- Multi-user accounts. One deployment = one person. Anyone can self-host their own copy.

## 2. Decisions

| Topic         | Decision                                                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name          | Sourcefold                                                                                                                                                                                                                                             |
| License       | MIT, public GitHub repo                                                                                                                                                                                                                                |
| Cost          | $0. Free tiers only.                                                                                                                                                                                                                                   |
| Platform      | Hosted web app (desktop browser) + Chrome extension                                                                                                                                                                                                    |
| Hosting       | Vercel Hobby (free)                                                                                                                                                                                                                                    |
| Backend       | Supabase free plan: Postgres, Auth (Google), Storage                                                                                                                                                                                                   |
| Master copy   | Supabase database                                                                                                                                                                                                                                      |
| Drive         | One-way mirror. One **Save to Drive** button (and Ctrl+S) saves everything changed. Drive never writes back.                                                                                                                                           |
| Organizing    | Folders inside folders, unlimited depth. A "project" is a top-level folder.                                                                                                                                                                            |
| One home      | Each item lives in exactly one folder.                                                                                                                                                                                                                 |
| Search        | Titles only                                                                                                                                                                                                                                            |
| Duplicates    | Warn "already saved in <folder>", do not save twice                                                                                                                                                                                                    |
| File format   | Markdown with a YAML front-matter header                                                                                                                                                                                                               |
| Grokipedia    | Bulk paste box in the app. Saved once, never updated. Keep tables, inline links and the references list with links.                                                                                                                                    |
| Substack      | Captured by the extension. Free posts, plus paid posts you subscribe to (the extension reads the page while you are logged in). Paid posts you cannot access: show "paid post, not saved". Skip comments and images. Save author and publication info. |
| X             | Captured by the extension. Text only. Keep post link, author name, handle, profile link and date. Threads and reposts stored as a tree. "Add to this thread" attaches more posts later.                                                                |
| Notes         | A note box on every item, plus standalone notes (Markdown text) that live in folders like sources                                                                                                                                                      |
| Own sources   | Pasted text (as notes) and uploaded images                                                                                                                                                                                                             |
| Capture style | One click reads the page you are viewing                                                                                                                                                                                                               |

## 3. Architecture

```
Chrome extension (WXT, MV3)            Web app (Next.js on Vercel)
 - reads X / Substack pages      --->   - API routes (/api/*)
 - folder picker, save button    token  - UI: folder tree, item list, paste box
 - "add to this thread"                 - Grokipedia fetch + Markdown conversion
                                        - Save to Drive
                                              |
                          +-------------------+------------------+
                          v                                      v
                 Supabase (free)                         Google Drive API
                 - Postgres (master data)                (drive.file scope)
                 - Auth (Google sign-in)                 Sourcefold/<folders>/<file>.md
                 - Storage (uploaded images)
```

### Repo layout (npm workspaces)

```
apps/web/          Next.js app (UI + API routes)
apps/extension/    Chrome extension (WXT)
packages/core/     Shared types, URL canonicalization, Markdown builders, front matter
supabase/          SQL migrations
docs/              Spec and references
```

### Where fetching happens

| Source     | Fetched by     | Why                                                                                                                                                              |
| ---------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grokipedia | Web app server | Pages are plain HTML (tested 2026-10-13 from a home connection). Enables bulk paste. Fallback if Vercel's servers get blocked: the extension fetches it instead. |
| Substack   | Extension      | Uses your logged-in session for subscribed paid posts. No cookies leave your browser.                                                                            |
| X          | Extension      | X blocks logged-out access and its API is paid. Reading the page you are viewing avoids both.                                                                    |

### Authentication

- **Web app:** Supabase Auth with Google. Sign-in is restricted to `ALLOWED_EMAIL` (env var). Row-level security on every table, keyed by `user_id`.
- **Google Drive:** request scope `https://www.googleapis.com/auth/drive.file` (the app only sees files it created) with `access_type=offline` and `prompt=consent`. Supabase returns `provider_refresh_token` only at sign-in, so the app stores it in `google_tokens` (server-only access) and refreshes access tokens with Google directly.
- **Google OAuth app:** set the consent screen to **In production**. In "Testing" mode Google expires refresh tokens after 7 days, which would silently break Save to Drive.
- **Extension:** a personal access token created in the app's Settings page and pasted into the extension once. Stored hashed in `api_tokens`. Sent as `Authorization: Bearer <token>`.

### Keep-alive

Supabase pauses free projects after about a week with no activity. A GitHub Actions workflow calls `GET /api/health` once a day; that route runs a trivial database query. Free, and it also alerts you (failed workflow email) if the app is down.

## 4. Data model (Postgres)

All tables have `user_id uuid not null references auth.users`, `created_at`, `updated_at`. Soft delete via `deleted_at` so Drive can mirror deletions.

**folders**

- `id uuid pk`, `parent_id uuid null references folders`, `name text`, `position int`
- `drive_folder_id text null`, `drive_synced_at timestamptz null`, `deleted_at timestamptz null`

**items**

- `id uuid pk`, `folder_id uuid references folders`
- `kind text` one of `grokipedia | substack | x | note | image`
- `title text` (the heading; this is the "description" in the list)
- `source_url text null`, `canonical_url text null`, unique per user where `deleted_at is null`
- `status text` one of `pending | saved | failed | unavailable` (unavailable = paid post you cannot access)
- `error text null`
- `markdown text null` (the generated file body, including front matter)
- `meta jsonb` (per-kind fields, see section 5)
- `note text null` (your note on this item)
- `position int`
- `storage_path text null` (uploaded images, in Supabase Storage)
- `drive_file_id text null`, `drive_synced_at timestamptz null`, `deleted_at timestamptz null`

**x_posts** (nodes of an X tree; the tree's item has `kind = 'x'`)

- `id uuid pk`, `item_id uuid references items`, `parent_id uuid null references x_posts`
- `post_url text`, `canonical_url text`, unique per item
- `author_name text`, `handle text`, `author_url text`, `posted_at timestamptz`, `text text`, `position int`

**api_tokens**: `id`, `name`, `token_hash`, `last_used_at`, `revoked_at`

**google_tokens**: `user_id pk`, `refresh_token text`, `updated_at`. No client-side access (no RLS select policy; server uses the service role).

**drive_state**: `user_id pk`, `root_folder_id text null`, `last_saved_at timestamptz null`

### Dirty tracking

An item or folder needs saving when `drive_synced_at is null` or `updated_at > drive_synced_at`, or it is deleted and still has a Drive id. The UI shows the unsaved count next to the Save button.

## 5. Markdown formats

All files start with front matter. Fields that do not apply are omitted.

### Grokipedia

```markdown
---
source: grokipedia
title: Impact of Artificial Intelligence on the Future
url: https://grokipedia.com/page/Impact_of_Artificial_Intelligence_on_the_Future
summary: The impact of artificial intelligence (AI) on the future encompasses ...
fact_checked: 2026-09-29
saved: 2026-10-13
folder: AI Research/Risks
---

# Impact of Artificial Intelligence on the Future

> Saved from Grokipedia on 2026-10-13. Grokipedia articles change; see the live page and its edit history: <url>

...article body: headings, paragraphs, tables, inline links...

## References

[^1]: [Artificial Intelligence and the Future of Humans | Pew Research Center](https://...) - pewresearch.org
[^2]: ...
```

- `summary` comes from the page's meta description (the first paragraph). Free to keep; the list shows the title only.
- `fact_checked` comes from the page's JSON-LD `dateModified` (the "Fact-checked by Grok" date).
- Citation markers in the body become GFM footnotes (`[^1]`), and each reference is the matching footnote definition, so the citations stay readable as plain text in NotebookLM and other tools.

### Substack

```markdown
---
source: substack
title: <post title>
subtitle: <post subtitle>
url: <canonical post url>
author: <name>
author_url: <profile url>
publication: <publication name>
publication_url: <publication home>
published: 2026-09-20
access: free | paid
saved: 2026-10-13
folder: ...
---

# <post title>

...post body, links and tables kept, images removed...
```

### X

```markdown
---
source: x
title: Thread by Jane Doe (@jane)
url: https://x.com/jane/status/123
author: Jane Doe (@jane)
author_url: https://x.com/jane
posted: 2026-10-01
saved: 2026-10-13
folder: ...
---

# Thread by Jane Doe (@jane)

**Jane Doe** (@jane) · 2026-10-01 · [link](https://x.com/jane/status/123)

First post text.

> **Jane Doe** (@jane) · 2026-10-01 · [link](https://x.com/jane/status/124)
>
> Second post in the thread.
>
> > **Sam Lee** (@sam) · 2026-10-02 · [link](https://x.com/sam/status/200)
> >
> > A reply or repost added later with "Add to this thread".
```

Each level of the tree is one more `>`. The item title is "Thread by <name> (@handle)" for threads and "Post by <name> (@handle)" for single posts; you can rename it.

### Notes

Front matter (`source: note`, `title`, `created`, `folder`) then your Markdown.

### File names in Drive

`<title-slug>.md`. If two files in one folder would clash, append the first 6 characters of the item id: `ai-risks-3f80c7.md`.

## 6. Web app

### Layout

- **Left:** folder tree. Create, rename, delete, drag to move or reorder. Folders inside folders.
- **Top bar:** title search box, **Add links** button (Grokipedia paste box), **Save to Drive** button with unsaved count and last-saved time.
- **Main:** items in the selected folder. Each row: source icon, title, author (Substack/X), date, status. Click opens the source URL in a new tab. Notes open in an editor. A row menu: edit note, rename, move, delete, retry (failed items).

### Grokipedia paste box

1. Paste links, one per line (mixed text is fine; URLs are extracted).
2. Pick the target folder.
3. The client sends links one at a time to `POST /api/grokipedia` (avoids serverless timeouts) with a short delay between requests.
4. Each row shows saved / already saved in <folder> / failed with retry.

### Title search

Case-insensitive match on `title` across all folders. Results show the folder path.

### Save to Drive (Ctrl+S)

1. Ensure a root folder `Sourcefold` exists in Drive (created by the app).
2. Folders, top-down: create missing, rename changed, move re-parented, trash deleted.
3. Items: create or update the `.md` (images: upload the file), move if the folder changed, rename if the title changed, trash if deleted.
4. Mark each folder and item synced as soon as it succeeds, so an interruption resumes where it stopped.
5. Work is batched: the client calls `POST /api/drive/save` repeatedly until it reports done.
6. Deletions go to Drive's trash (recoverable for 30 days), never permanent delete.

### Settings

- Connect / reconnect Google Drive
- Create and revoke extension tokens
- Shows the Drive root folder link

## 7. Chrome extension

### Popup

1. Detects the page: Grokipedia article, Substack post, X post, or unsupported.
2. Folder picker (tree), defaults to the last folder used. "New folder" inline.
3. **Save** button. Result: saved / already saved in <folder> / paid post, not saved / failed (with reason).
4. On X: **Add to this thread** lists recent X items to attach the current post to.

### Other entry points

- Right-click a link: "Save to Sourcefold". Works for Grokipedia links (server fetch). For X and Substack links, open the page first (v1).
- Keyboard shortcut to open the popup (default `Alt+Shift+S`, changeable in Chrome).

### Capture rules

- **X:** on a status page, read `article` elements for the post and the author's own thread above and below it (same handle, connected). Per post: text, name, handle, profile URL, post URL, `time[datetime]`. All X selectors live in one file so fixing breakage after an X redesign is a one-file change.
- **Substack:** detect the paywall element; if present, return `unavailable`. Otherwise run Readability on the post body, drop images and comments, read author and publication from page metadata (JSON-LD and meta tags), then convert to Markdown.
- **Grokipedia:** send the URL to the server; the server fetches and converts.

### Settings page

- App URL and access token
- Test connection button

## 8. API (web app)

All routes require a Supabase session (web) or a Bearer token (extension).

| Method            | Route                   | Purpose                                       |
| ----------------- | ----------------------- | --------------------------------------------- |
| GET               | `/api/health`           | Keep-alive and uptime check (no auth)         |
| GET               | `/api/folders`          | Folder tree                                   |
| POST/PATCH/DELETE | `/api/folders[/:id]`    | Create, rename/move/reorder, delete           |
| GET               | `/api/items?folder=&q=` | Items in a folder, or title search            |
| POST              | `/api/items/check`      | Duplicate check for a URL                     |
| POST              | `/api/grokipedia`       | Fetch, convert and save one Grokipedia URL    |
| POST              | `/api/capture`          | Save extension-captured Substack or X content |
| POST              | `/api/x/:itemId/posts`  | Add a post to an X tree                       |
| PATCH/DELETE      | `/api/items/:id`        | Rename, move, note, delete                    |
| POST              | `/api/notes`            | Create a standalone note                      |
| POST              | `/api/uploads`          | Upload an image source                        |
| POST              | `/api/drive/save`       | Run one batch of the Drive save               |
| POST/DELETE       | `/api/tokens[/:id]`     | Create or revoke extension tokens             |

## 9. URL canonicalization (duplicates)

- Lowercase host, drop `www.`, drop query string and fragment, drop trailing slash.
- `twitter.com`, `mobile.twitter.com`, `mobile.x.com` become `x.com`; X status URLs reduce to `x.com/<handle>/status/<id>`, and duplicates match on the status id.
- Substack: use the page's `<link rel="canonical">` (handles custom domains).
- Grokipedia: `grokipedia.com/page/<Title>` with the title URL-decoded.

## 10. Build plan (waves)

Each wave ends with a working, deployed app. Tasks inside a wave marked **(parallel)** can go to separate subagents.

### Wave 0: Setup (done 2026-10-13)

- Spec, MIT license, README, public GitHub repo.

### Wave 1: Foundation

- Monorepo scaffold: npm workspaces, TypeScript, lint, format.
- Supabase project, migrations for all tables, RLS policies.
- Google sign-in with `ALLOWED_EMAIL` restriction.
- Folder tree CRUD (create, rename, nest, move, delete) and empty item list.
- Title search.
- `/api/health` + GitHub Actions keep-alive.
- Deploy to Vercel.
- **Done when:** you can sign in on the live URL and build a nested folder tree.

### Wave 2: Grokipedia (parallel with Wave 3)

- `packages/core`: HTML-to-Markdown (Turndown + GFM tables), front matter, canonical URLs, file-name slugs.
- `POST /api/grokipedia`: fetch, extract title, summary, fact-checked date, body, references.
- Paste box UI with per-link status, duplicate warning, retry.
- Test from Vercel that Grokipedia is reachable; if blocked, route through the extension.
- **Done when:** 40 pasted links become 40 saved items with correct references.

### Wave 3: Extension + Substack (parallel with Wave 2)

- WXT extension scaffold, settings page, token auth, `/api/tokens`.
- Popup: page detection, folder picker with last-used default, save, status messages.
- Substack capture: free and subscribed paid posts, paywall detection, author and publication metadata.
- `POST /api/capture`.
- **Done when:** saving a free post, a subscribed paid post and an inaccessible paid post each gives the right result.

### Wave 4: X

- X capture: single post, author thread, tree building.
- "Add to this thread".
- X Markdown renderer.
- **Done when:** a thread, a quote/repost and a later-added reply render as one correct tree file.

### Wave 5: Save to Drive (parallel with Wave 4)

- Google `drive.file` consent and refresh-token storage.
- Folder mirroring, file create/update/move/rename/trash, resumable batches, Ctrl+S, unsaved count.
- **Done when:** renaming, moving and deleting in the app shows up correctly in Drive after one Save.

### Wave 6: Notes and own sources

- Note box on items, standalone notes with a Markdown editor, image uploads to Supabase Storage (copied to Drive on Save).

### Wave 7: Polish

- Right-click save, keyboard shortcut, error states, empty states.
- Self-hosting guide in README (Supabase, Google Cloud, Vercel setup).

## 11. Risks and checks

| Risk                                                         | Plan                                                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Grokipedia blocks Vercel's servers                           | Test in Wave 2. Fallback: extension fetches the page.                                                                                                                                      |
| X changes its page structure                                 | All selectors in one file; capture failures show a clear error.                                                                                                                            |
| Supabase free project pauses                                 | Daily keep-alive workflow.                                                                                                                                                                 |
| Google refresh token expires                                 | OAuth app set to "In production"; app shows "Reconnect Drive" if refresh fails.                                                                                                            |
| Free limits (500 MB database, 1 GB storage on Supabase free) | Text is small; thousands of articles fit. Images are the only large data.                                                                                                                  |
| Project folder is inside OneDrive                            | OneDrive syncing `node_modules` causes slowdowns and file locks. Move the repo outside OneDrive (for example `C:\dev\sourcefold`) before Wave 1, or exclude the folder from OneDrive sync. |

## 12. Your setup tasks (needed for Wave 1)

1. **Google Cloud:** create a project, an OAuth client (Web), enable the Google Drive API, set the consent screen to In production. Wave 1 will give exact step-by-step instructions and redirect URLs.
2. **Supabase:** a new free project for Sourcefold (can be created through the Supabase MCP).
3. **Vercel:** sign in with GitHub and import the repo.
