# Sourcefold spec

Version 1, 2026-10-13. Source of truth for what we build. Decisions here came from the Q&A on the original Notion page ("scraper and collector").

## 1. Goal

A personal, open-source research tool. Save sources from Grokipedia, Wikipedia, Substack and X into folders, keep each source as clean Markdown, and push everything to Google Drive with one button. The Markdown goes into NotebookLM, Gemini and other tools for research and YouTube video prep.

Later (not in scope now): a public website per video where every claim links to its source.

### Non-goals (v1)

- Reading sources inside the web app. Clicking an item opens the original page. (The desktop app includes an integrated Markdown reader for saved sources that have markdown content, while still offering opening the source URL in the browser with `Shift+Enter` or `o`).
- Search beyond titles. No full-text or embedding search.
- Mobile apps or phone capture.
- Images or video from X.
- Paid Substack posts you do not subscribe to.
- Re-scraping or versioning Grokipedia articles.
- Accounts shared between people (teams, shared folders). A deployment can let several people sign in (`ALLOWED_EMAIL` list or `*`), but each person's library is separate.

## 2. Decisions

| Topic               | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name                | Sourcefold                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| License             | MIT, public GitHub repo                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Cost                | $0. Free tiers only (desktop app binaries are unsigned for personal use with no developer program fees).                                                                                                                                                                                                                                                                                                                                                                                   |
| Platform            | Hosted web app (desktop browser), desktop app (Windows and macOS), and Chrome extension                                                                                                                                                                                                                                                                                                                                                                                                    |
| Hosting             | Vercel Hobby (free)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Backend             | Supabase free plan: Postgres, Auth (Google), Storage                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Master copy         | In signed-in mode (web and desktop), Supabase holds links, titles, metadata, folders, and notes. Article text and images live only in Drive (pushed automatically right after saving, then cleared from Supabase; see "Where content lives" in section 4). In offline desktop mode, an embedded SQLite database and local disk files hold all data.                                                                                                                                        |
| Drive               | One-way mirror. One **Save to Drive** button (and Ctrl+S) saves everything changed. Drive never writes back. Available in the web app and signed-in desktop mode; not available in offline desktop mode.                                                                                                                                                                                                                                                                                   |
| Organizing          | Projects, each with groups inside groups (unlimited depth). In the database both are `folders`: a project is a top-level folder, a group is any folder inside one.                                                                                                                                                                                                                                                                                                                         |
| One home            | Each item lives in exactly one group. Sources can't be saved directly in a project (enforced by the `check_item_folder` trigger).                                                                                                                                                                                                                                                                                                                                                          |
| Search              | Titles only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Duplicates          | A link is saved once per group: warn "Already saved in <group>" for the same group. The same link can be saved in other groups of the same project and in other projects. Projects are isolated: search, duplicate checks and "Add to this thread" never cross projects.                                                                                                                                                                                                                   |
| File format         | Markdown with a YAML front-matter header                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Grokipedia          | Bulk paste box in the app. Saved once, never updated. Keep tables, inline links and the references list with links.                                                                                                                                                                                                                                                                                                                                                                        |
| Wikipedia           | Pasted into Add links in the web app or the desktop app (signed in or offline), any language edition. Saved once, never updated. Fetched through Wikimedia's REST API, with the article's text, infobox, pictures, formulas, tables and footnoted references kept. The text is CC BY-SA 4.0: the file names the article and links to it, and that attribution stays with every copy.                                                                                                       |
| Substack            | Captured by the extension, or pasted into the desktop app's Add links (single posts or a whole publication, with an optional date range). Free posts, plus paid posts you subscribe to (the extension reads the page while you are logged in; the desktop uses your `substack.sid` cookie, kept on your computer). Paid posts you cannot access: show "paid post, not saved". Skip comments. Keep images as links to the original upload, with captions. Save author and publication info. |
| X                   | Captured by the extension. Text only. Keep post link, author name, handle, profile link and date. Threads and reposts stored as a tree. "Add to this thread" attaches more posts later.                                                                                                                                                                                                                                                                                                    |
| YouTube             | Pasted into the desktop app's Add links (a video, or a playlist or channel to pick every video), or saved by the extension while watching. Saves the transcript in timestamped paragraphs (each links to that moment) plus the description. Free: no API key, method from youtube-transcript-api. A video without captions saves as "No captions on this video". Captions are never generated locally.                                                                                     |
| Web pages           | Any other link, pasted into Add links (web and desktop) or saved by the extension from the open page (works on pages you're logged into). Main content found by defuddle, images kept with captions. Covers news, blogs, Britannica, free Medium, Ghost and beehiiv posts.                                                                                                                                                                                                                 |
| PDFs, arXiv         | Pasted into Add links (web and desktop). Text with pdf.js; arXiv papers use arXiv's HTML version when there is one, with math kept as LaTeX.                                                                                                                                                                                                                                                                                                                                               |
| Reddit, HN, Bluesky | Pasted into Add links or saved by the extension. The post, then the comments as nested quotes with authors, scores and links. Reddit often refuses servers; use the desktop app or the extension.                                                                                                                                                                                                                                                                                          |
| Notes               | A note box on every item, plus standalone notes (Markdown text) that live in folders like sources                                                                                                                                                                                                                                                                                                                                                                                          |
| Own sources         | Pasted text (as notes) and uploaded images                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Capture style       | One click reads the page you are viewing                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 3. Architecture

```text
                            Chrome extension (WXT, MV3)
                            - reads X / Substack pages
                            - folder picker, save button
                            - Auto target: desktop app or web
                                  /             \
                native / loopback/               \ bearer token
                                v                 v
Desktop app (Tauri v2)   <--------------->  Web app (Next.js on Vercel)
- UI: folders, items, reader                - API routes (/api/*)
- SQLite db: sourcefold.db   session token  - Grokipedia fetch & conversion
- Markdown files on disk                    - Save to Drive
- Local HTTP (23456) & Native host                |
                                    +-------------+-------------+
                                    v                           v
                           Supabase (free)               Google Drive API
                           - Postgres (master data)      (drive.file scope)
                           - Auth (Google sign-in)       Sourcefold/<folders>/<file>.md
                           - Storage (uploaded images)
```

### Repo layout (npm workspaces)

```text
apps/web/          Next.js app (UI + API routes)
apps/desktop/      Desktop app (Tauri v2: React 19 + Rust + SQLite)
apps/extension/    Chrome extension (WXT)
packages/core/     Shared types, URL canonicalization, Markdown builders, front matter
supabase/          SQL migrations
docs/              Spec and references
```

### Where fetching happens

| Source                               | Fetched by                                                   | Why                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grokipedia                           | Web app server or desktop app                                | Pages are plain HTML (tested 2026-10-13 from a home connection). Enables bulk paste. Fallback if Vercel's servers get blocked: the extension fetches it instead.                                                                                                                                                                      |
| Wikipedia                            | Web app server, or the desktop app's webview                 | Wikimedia's REST API (`/api/rest_v1/page/html/<title>` and `/page/summary/<title>`) sends CORS headers, so the desktop fetches it directly and the web app server fetches it with a descriptive `User-Agent`. Redirects are followed.                                                                                                 |
| Substack                             | Extension                                                    | Uses your logged-in session for subscribed paid posts. No cookies leave your browser.                                                                                                                                                                                                                                                 |
| YouTube                              | Desktop app (Rust `web_fetch`) or extension                  | YouTube blocks cloud servers. The desktop asks from the user's own connection; the extension asks same-origin from youtube.com. The web app's Add links says to use one of them.                                                                                                                                                      |
| Web pages, PDFs, Reddit, HN, Bluesky | Web app server, desktop app (Rust `web_fetch`), or extension | `fetchSourceCapture` in `packages/core/src/sources.ts` routes a link to its extractor; each app passes its own fetch. The desktop's `web_fetch` refuses this computer and local-network addresses on every redirect. Sites with bot walls (Reddit, Britannica) refuse servers and scripts: the extension reads the open page instead. |
| X                                    | Extension                                                    | X blocks logged-out access and its API is paid. Reading the page you are viewing avoids both.                                                                                                                                                                                                                                         |

### Authentication

- **Web app:** Supabase Auth with Google. Sign-in is restricted to `ALLOWED_EMAIL` (env var: a comma-separated list, or `*` for any Google account). Server-side fetches of pasted links go through `publicFetch`, which refuses private and internal addresses on every redirect hop. Row-level security on every table, keyed by `user_id`.
- **Google Drive:** request scope `https://www.googleapis.com/auth/drive.file` (the app only sees files it created) with `access_type=offline` and `prompt=consent`. Supabase returns `provider_refresh_token` only at sign-in, so the app stores it in `google_tokens` (server-only access) and refreshes access tokens with Google directly.
- **Google OAuth app:** set the consent screen to **In production**. In "Testing" mode Google expires refresh tokens after 7 days, which would silently break Save to Drive.
- **Desktop app:** connects to the web app with a personal access token created through a browser loopback sign-in flow (`/desktop/connect`). Stored locally in `session.json`. Web API routes authenticate token requests via `requireApiUser`.
- **Extension:** a personal access token created in the app's Settings page, or obtained automatically from the desktop app via native messaging or local HTTP. Stored hashed in `api_tokens`. Sent as `Authorization: Bearer <token>`.

### Keep-alive

Supabase pauses free projects after about a week with no activity. A GitHub Actions workflow calls `GET /api/health` once a day; that route runs a trivial database query. Free, and it also alerts you (failed workflow email) if the app is down.

## 4. Data model (Postgres)

All tables have `user_id uuid not null references auth.users`, `created_at`, `updated_at`. Soft delete via `deleted_at` so Drive can mirror deletions.

**folders**

- `id uuid pk`, `parent_id uuid null references folders`, `name text`, `position int`
- `drive_folder_id text null`, `drive_synced_at timestamptz null`, `deleted_at timestamptz null`

**items**

- `id uuid pk`, `folder_id uuid references folders`
- `kind text` one of `grokipedia | substack | wikipedia | x | note | image`
- `title text` (the heading; this is the "description" in the list)
- `source_url text null`, `canonical_url text null`, unique per user where `deleted_at is null`
- `status text` one of `pending | saved | failed | unavailable` (unavailable = paid post you cannot access)
- `error text null`
- `markdown text null` (the Markdown body WITHOUT front matter; front matter is generated at Drive-save time from the item, its `meta` and its current folder path, so it never goes stale after a move or rename)
- `meta jsonb` (per-kind fields, see section 5)
- `note text null` (your note on this item)
- `position int`
- `storage_path text null` (uploaded images, in Supabase Storage)
- `drive_file_id text null`, `drive_synced_at timestamptz null`, `deleted_at timestamptz null`

**x_posts** (nodes of an X tree; the tree's item has `kind = 'x'`)

- `id uuid pk`, `item_id uuid references items`, `parent_id uuid null references x_posts`
- `post_url text`, `canonical_url text`, unique per item
- `author_name text`, `handle text`, `author_url text`, `posted_at timestamptz`, `text text`, `position int`
- `media jsonb` (default `[]`, at most 10): the post's photos and GIFs as links (`{type, url, alt}`) and videos as `{type: "video", durationSeconds}`. Only links live here; the files go to Drive and the local copy. See `docs/dev/handoff-x-media.md`.

**api_tokens**: `id`, `name`, `token_hash`, `last_used_at`, `revoked_at`

**google_tokens**: `user_id pk`, `refresh_token text`, `updated_at`. No client-side access (no RLS select policy; server uses the service role).

**drive_state**: `user_id pk`, `root_folder_id text null`, `last_saved_at timestamptz null`

### Where content lives

To keep the Supabase free plan small (500 MB database, 1 GB storage; a Grokipedia article is about 200 KB of Markdown), Supabase is only an index:

- `items.markdown` (Grokipedia, Wikipedia, Substack, X) and `storage_path` (images) hold content only until it reaches Drive. `mark_item_stored_in_drive` clears them in the same update that marks the item synced, and only if the item didn't change during the upload.
- After a new source is saved, the server pushes to Drive in the background (`pushToDriveSoon`). If Drive isn't connected or another save is running, the item waits for the next save.
- A later rename, move or note change rebuilds the file from Drive: the save downloads the `.md`, drops its front matter and "My note" section (`bodyFromDriveFile`), and writes new ones. Images are only renamed or moved.
- Removing text from a saved source (the desktop reader's "Remove text" and "Edit as text") puts the cut body back into `items.markdown` with `PATCH /api/items/[id]` (`markdown`, text sources only, up to 2 MB) and starts `pushToDriveSoon`; the save then writes the Drive file, its Google Doc and image folder from that body and clears the column again. Offline, `update_item_body` rebuilds the file in SQLite and on disk. The reader's HTML marks each removable block with `data-sf-src="start-end"` (offsets into the body), and `removeFromBody` in `packages/core/src/reader/remove-text.ts` cuts the Markdown from those spans; a cut it can't place exactly is refused.
- Clicking an image opens its Drive copy once it has left Supabase.
- Kept in Supabase: notes' text (you edit them in the app) and `x_posts` (needed to rebuild a thread when you add a post).
- If you delete a file in Drive permanently, Drive held the only copy: the save reports it, and you delete the item and add it again.

### Dirty tracking

An item or folder needs saving when `drive_synced_at is null` or `updated_at > drive_synced_at`, or it is deleted and still has a Drive id. The UI shows the unsaved count next to the Save button.

## 5. Markdown formats

The canonical, cross-platform contract for file naming, folder naming, front matter schema, and body layout is specified in [FILE-FORMAT.md](../FILE-FORMAT.md).

All files start with YAML front matter. Fields that do not apply are omitted. Below is an overview of the canonical formats:

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

> Saved from [Grokipedia](https://grokipedia.com/page/Impact_of_Artificial_Intelligence_on_the_Future) on 2026-10-13. Grokipedia articles change; check the live page for edits.

...article body: headings start at ##, paragraphs, tables, inline links...

## References

[^1]: [Artificial Intelligence and the Future of Humans | Pew Research Center](https://...) - pewresearch.org

[^2]: <https://example.com/no-title-link> - example.com
```

- `summary` comes from the page's meta description (the first paragraph). Free to keep; the list shows the title only.
- `fact_checked` comes from the page's JSON-LD `dateModified` (the "Fact-checked by Grok" date).
- Citation markers in the body become GFM footnotes (`[^1]`), with citation runs deduped in first-seen order (`[^76][^77]`), and each reference is the matching footnote definition (with empty/URL titles wrapped in `<url>`).

### Wikipedia

```markdown
---
source: wikipedia
title: Turbocharger
url: https://en.wikipedia.org/wiki/Turbocharger
summary: Exhaust-powered forced-induction device for engines
language: en
revision: 1376335656
last_edited: 2026-09-23
saved: 2026-10-15
folder: Cars/Engines
---

# Turbocharger

> Saved from [Wikipedia](https://en.wikipedia.org/wiki/Turbocharger) on 2026-10-15. Wikipedia articles change; check the live page for edits.

Lead paragraph.[^1][^2]

![](https://upload.wikimedia.org/wikipedia/commons/4/42/Turbocharger_Animation_by_Tyroola.gif)

_A turbocharger (item 10) on a piston engine_

| Field    | Value                                                           |
| -------- | --------------------------------------------------------------- |
| Inventor | [Alfred Büchi](https://en.wikipedia.org/wiki/Alfred_B%C3%BCchi) |

## History

...article body: headings start at ##, paragraphs, lists, tables, formulas, inline links...

## References

[^1]: Nice, Karim (4 December 2000). ["How Turbochargers Work"](http://auto.howstuffworks.com/turbo.htm). Auto.howstuffworks.com.
```

- `summary` is Wikipedia's short description; `revision` and `last_edited` identify the exact revision the text came from.
- The Markdown comes from Wikimedia's REST page HTML, converted by `packages/core/src/wikipedia/convert.ts` (server: linkedom; desktop webview: DOMParser). It drops hatnotes, maintenance banners, "citation needed" tags, navboxes, sidebars, coordinates, edit links and the contents box. The infobox becomes a two-column `| Field | Value |` table right after the lead paragraph (preceded by its picture); infobox rows without a label are dropped, and so is an infobox with no usable row.
- References become GFM footnotes numbered by first use, shared when one source is cited again, with runs deduped (`[^1][^2][^1]` becomes `[^1][^2]`) and listed under `## References`. Links to other articles are absolute (`https://<language>.wikipedia.org/wiki/…`).
- Pictures and thumbnails become `![alt](full-size upload.wikimedia.org address)` followed by the caption in italics; images under 40px (flags, icons) are skipped. Formulas keep their LaTeX: `$…$` inline, `$$…$$` as their own block. Simple tables become GFM tables; tables with merged cells keep their text as one bullet per row.
- Wikipedia's text is CC BY-SA 4.0. The `url` front matter and the "Saved from" line are the attribution; keep them if you share or republish a file.

### Substack

```markdown
---
source: substack
title: Why Decentralized AI Matters
subtitle: An analysis of decentralized networks
url: https://example.substack.com/p/why-decentralized-ai-matters
author: Jane Doe
author_url: https://substack.com/@janedoe
publication: The AI Dispatch
publication_url: https://example.substack.com
published: 2026-10-10
access: free
saved: 2026-10-13
folder: AI Research/Decentralized
---

# Why Decentralized AI Matters

_An analysis of decentralized networks_

> Saved from [The AI Dispatch](https://example.substack.com/p/why-decentralized-ai-matters) on 2026-10-13. By Jane Doe. Published 2026-10-10.

...article body converted to clean Markdown...
```

### X

```markdown
---
source: x
title: Post by Jack Dorsey (@jack)
url: https://x.com/jack/status/20
author: Jack Dorsey
author_url: https://x.com/jack
posted: 2006-03-21
saved: 2026-10-13
folder: Archive/Social
---

# Post by Jack Dorsey (@jack)

> Saved from [X](https://x.com/jack/status/20) on 2026-10-13.

> just setting up my twttr
```

Threads render with nested blockquotes to show parent and reply relationships.

### Notes

```markdown
---
source: note
title: Meeting Notes
created: 2026-10-13
folder: Projects/Alpha
---

# Meeting Notes

Body of your note...
```

### Notes on saved items

If a user attaches a note to any saved item (e.g. Grokipedia, Substack, X), it is appended at the end of the file under a `## My note` section.

## 6. Web app

### Layout

- **Left:** project switcher (pick, create, rename, delete projects), then the open project's group tree. Create, rename, delete, drag to move or reorder groups, nest groups inside groups, or move a group to another project. Only one project is shown at a time; `/` reopens the last active project (cookie `sourcefold_project`). **Archive project** hides a finished project: it moves to an "Archived" list in the switcher and disappears from the extension, Add links, the Move dialog and search across projects. Nothing is deleted, nothing changes in Drive, and **Unarchive project** brings it back. Stored as `folders.archived_at` on the project, set through `set_project_archived`.
- **Top bar:** title search box, **Add links** button (Grokipedia and Wikipedia paste box), **Save to Drive** button with unsaved count and last-saved time.
- **Copy links:** on a group page, **Copy all links** copies every web link, one per line. **Select** shows checkboxes on sources with a web link; tick some and click **Copy N links**, or **Cancel**. Shift-click selects a range. Notes and uploaded images have no link and no checkbox.
- **Main:** a project page lists its groups (and any sources saved directly in the project, under "Not in a group"). A group page lists its subgroups, then its sources. Each row: source icon, title, author (Substack/X), date, status. Click opens the source URL in a new tab. Notes open in an editor. A row menu: edit note, rename, move, delete, retry (failed items).

### Grokipedia and Wikipedia paste box

1. Paste links, one per line (mixed text is fine; URLs are extracted). Grokipedia and Wikipedia links can be mixed.
2. Pick the target group (grouped by project).
3. The client sends links one at a time to `POST /api/grokipedia` or `POST /api/wikipedia`, depending on the link (avoids serverless timeouts), with a short delay between requests.
4. Each row shows saved / already saved in <group> / failed with retry.

### Title search

Case-insensitive match on `title` within the open project (across all projects if none is open). Results show the group path.

### Save to Drive (Ctrl+S)

1. Ensure a root folder `Sourcefold` exists in Drive (created by the app).
2. Folders, top-down: create missing, rename changed, move re-parented, trash deleted.
3. Items: create or update the `.md` (images: upload the file), move if the folder changed, rename if the title changed, trash if deleted.
4. Mark each folder and item synced as soon as it succeeds, so an interruption resumes where it stopped.
5. Work is batched: the client calls `POST /api/drive/save` repeatedly until it reports done.
6. Deletions go to Drive's trash (recoverable for 30 days), never permanent delete.
7. Every text item (any kind but image) also gets a Google Doc next to its `.md`, with the same name minus `.md`, so sources can be read laid out like the original (images where they were, captions under them). It is created, renamed, moved and trashed with the file. The signed-in desktop's local copy exports that Doc as a `.docx` beside the `.md`. See "Google Docs and Word copies" in `docs/FILE-FORMAT.md`.

### Settings

- Connect / reconnect Google Drive
- Create and revoke extension tokens
- Shows the Drive root folder link

## 7. Chrome extension

### Target resolution

The extension offers three connection modes in Options: **Auto** (default), **Desktop app only**, and **Web app only**.

In **Auto** mode:

1. Queries the desktop app for an active session (`get_session` via Native Messaging, falling back to `GET http://127.0.0.1:23456/api/session`).
2. If the desktop app is running and signed in: saves directly to the user's account using the web app API (`session.webUrl` with `session.token`).
3. If the desktop app is running but offline: saves to the desktop app's local SQLite library over Native Messaging or local HTTP.
4. If the desktop app is unreachable: falls back to the web app URL and access token configured in extension options.
5. If neither target is configured or reachable: prompts the user to open the desktop app or enter settings.

The extension popup shows where saves will land (for example, "Saving to your account (via desktop app)", "Saving to this computer (desktop app, offline)", or "Saving to <host>").

### Popup

1. Detects the page: Grokipedia article, Substack post, X post, or unsupported.
2. Group picker, grouped by project, defaults to the last group used. "New group" inline (in the selected group's project, or inside the selected group).
3. **Save** button. Result: saved / already saved in <group> (checked for the selected group, re-checked when the group changes) / paid post, not saved / failed (with reason).
4. On X: **Add to this thread** lists recent X items to attach the current post to.

### Other entry points

- Right-click a link: "Save to Sourcefold". Works for Grokipedia links (server fetch). For X and Substack links, open the page first (v1).
- Keyboard shortcut to open the popup (default `Alt+Shift+S`, changeable in Chrome).

### Capture rules

- **X:** on a status page, read `article` elements for the post and the author's own thread above and below it (same handle, connected). Per post: text, name, handle, profile URL, post URL, `time[datetime]`. All X selectors live in one file so fixing breakage after an X redesign is a one-file change.
- **Substack:** detect the paywall element; if present, return `unavailable`. Otherwise read the post body, keep images as Markdown image links (see `docs/FILE-FORMAT.md`), drop comments, read author and publication from page metadata (JSON-LD and meta tags), then convert to Markdown.
- **Grokipedia:** send the URL to the server; the server fetches and converts.

### Settings page

- Connection mode selector: Auto (default), Desktop app only, or Web app only.
- Web app URL and access token for web fallback.
- Test connection button.

## 8. Desktop app

A native desktop application for Windows and macOS built with Tauri v2, React 19, Tailwind CSS v4, and Rust.

### Modes

- **Signed in:** connects to your Sourcefold web deployment with an API token. Desktop and web share the same projects, groups, and sources. Article text and images live in Google Drive as configured on your web backend. The desktop view reloads automatically on window focus and every 30 seconds while visible. The desktop also keeps a copy of every file on this computer, in the storage folder (default `Documents/Sourcefold`), laid out exactly like the Drive folder (Settings → General → **Keep a copy on this computer**, on by default). It reads `GET /api/mirror` (every file's path and version) and downloads changed files from `GET /api/items/[id]/content`; it only ever moves or deletes files it wrote itself.
- **Offline:** a local library on this computer using embedded SQLite (`sourcefold.db`). Markdown files with YAML front matter are saved directly to disk (`Documents/Sourcefold/` by default). Works without network access or cloud accounts.

### Sign-in flow

1. Open desktop Settings and enter your Sourcefold web address (for example `http://localhost:3000` or `https://<app>.vercel.app`).
2. Click **Sign in with browser**.
3. The desktop app starts a temporary loopback HTTP server on a random port (`127.0.0.1:<random port>`) and opens your browser to `/desktop/connect?callback=...&state=...`.
4. While signed in to your web deployment, click **Connect**.
5. The web app generates a personal API token named "Sourcefold Desktop" in `api_tokens` and redirects back to the loopback callback.
6. The desktop app stores the session in `session.json` next to `sourcefold.db` and brings the window to front.
7. Click **Sign out** in desktop Settings to clear `session.json`, or revoke the token from the web app's Settings page.

### Data location

- **SQLite database:** `%LOCALAPPDATA%\Sourcefold\sourcefold.db` on Windows, `~/Library/Application Support/Sourcefold/sourcefold.db` on macOS.
- **Session file:** `session.json` in the same directory as `sourcefold.db`.
- **Markdown files (offline mode):** `Documents/Sourcefold/` (or custom directory set in Settings), organized by project and group.

### Local integration surface and security rules

The desktop app exposes two communication channels for the Chrome extension:

- **Chrome Native Messaging:** host name `com.sourcefold.native`, communicating over stdin and stdout.
- **Local HTTP loopback:** server on `http://127.0.0.1:23456`.

Security rules on the local HTTP server:

- **Host validation:** only requests with `Host: localhost` or `Host: 127.0.0.1` (with optional port) are accepted. All other Host headers return 403 Forbidden.
- **Origin validation:** only allowed origins (`chrome-extension://...`, `tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost`, and in debug `localhost:5173`) are accepted. Other origins return 403 Forbidden. Requests without an Origin header return 403 Forbidden, except unauthenticated `GET /api/health` and `GET /api/status`.
- **No CORS wildcard:** the server never sends `Access-Control-Allow-Origin: *`. It reflects the verified allowed origin alongside `Vary: Origin`.
- **Session endpoint protection:** `GET /api/session` strictly requires an origin starting with `chrome-extension://`.

### What's not supported offline

- **Google Drive sync:** Drive sync requires the web backend and Google OAuth credentials; offline libraries stay local on disk and in SQLite.
- **Multi-device sync:** offline libraries do not sync between devices.

## 9. API (web app)

All routes require a Supabase session (web cookie) or a Bearer token (`Authorization: Bearer <token>`), verified by `requireApiUser`.

Token requests use the Supabase admin client (`createAdminClient()`), which bypasses database Row-Level Security. Every database query in token-authenticated endpoints must explicitly filter by `user_id`. Database RPCs that rely on `auth.uid()` cannot be used with token authentication; they must accept `p_user_id` as an explicit parameter.

| Method            | Route                   | Purpose                                        |
| ----------------- | ----------------------- | ---------------------------------------------- |
| GET               | `/api/health`           | Keep-alive and uptime check (no auth)          |
| GET               | `/api/folders`          | Folder tree                                    |
| POST/PATCH/DELETE | `/api/folders[/:id]`    | Create, rename/move/reorder, delete            |
| GET               | `/api/items?folder=&q=` | Items in a folder, or title search             |
| POST              | `/api/items/check`      | Duplicate check for a URL                      |
| POST              | `/api/grokipedia`       | Fetch, convert and save one Grokipedia URL     |
| POST              | `/api/wikipedia`        | Fetch, convert and save one Wikipedia URL      |
| POST              | `/api/capture`          | Save captured Substack, X or Wikipedia content |
| POST              | `/api/x/:itemId/posts`  | Add a post to an X tree                        |
| PATCH/DELETE      | `/api/items/:id`        | Rename, move, note, delete                     |
| POST              | `/api/notes`            | Create a standalone note                       |
| POST              | `/api/uploads`          | Upload an image source                         |
| POST              | `/api/drive/save`       | Run one batch of the Drive save                |
| POST/DELETE       | `/api/tokens[/:id]`     | Create or revoke extension tokens              |

## 10. URL canonicalization (duplicates)

- Lowercase host, drop `www.`, drop query string and fragment, drop trailing slash.
- `twitter.com`, `mobile.twitter.com`, `mobile.x.com` become `x.com`; X status URLs reduce to `x.com/<handle>/status/<id>`, and duplicates match on the status id.
- Substack: use the page's `<link rel="canonical">` (handles custom domains).
- Grokipedia: `grokipedia.com/page/<Title>` with the title URL-decoded.
- Wikipedia: `https://<language>.wikipedia.org/wiki/<Title>` with underscores for spaces and parentheses written `%28` / `%29`. The mobile host (`xx.m.wikipedia.org`), `index.php?title=<Title>` links, `#section` and other query parameters all reduce to it; links to other namespaces (`Talk:`, `File:`, `Category:`, `Special:` and so on) are not articles and are rejected. A link that redirects is also checked under the title it led to.

## 11. Build plan (waves)

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
