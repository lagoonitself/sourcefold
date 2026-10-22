# Plan: project files and shared projects

Status: planned 2026-10-22, nothing built yet. The owner's answers to the open questions are under "Decisions" at the end.

## What the owner asked for

1. **Project file.** Download a whole project as one file and send it to a friend. The friend opens Sourcefold, imports the file, and gets the same project: groups, subgroups, sources, links, Markdown, images, everything. Nothing stays connected afterwards.
2. **Shared project.** Like Google Docs or Notion: the owner and a friend both work in one project and see exactly the same thing. Every change is written down (who, what, when), and any change can be undone.
3. Shared content lives in **Cloudflare R2** (free plan: 10 GB), not Google Drive.

The two are separate features. The project file needs no server and no R2, so it comes first.

## Part A: project file

### What the user sees

- Project menu → **Download project file**. It saves `Cars.sourcefold`. A bar shows progress for big projects.
- Project switcher → **Import project file**. Before importing it shows what's inside: "Cars: 6 groups, 212 sources, 1,034 highlights, 38 MB". **Import** adds it as a new project (a name already in use becomes "Cars (2)").
- Works on the website, the desktop app signed in, and the desktop app offline. A file made in one opens in all three.
- The file can be sent any way (WhatsApp, email, a Drive link). The friend can use the owner's Sourcefold website, their own copy of Sourcefold, or the offline desktop app.

### What's in the file

A `.sourcefold` file is a zip:

```
sourcefold.json                       manifest (below)
Cars/Engines/Turbocharger.md          the same files Drive gets (docs/FILE-FORMAT.md)
Cars/Engines/Turbocharger_files/…     post images, X photos, GIFs as .mp4
Cars/Engines/Diagram.png              uploaded image sources
```

- Anyone can unzip it and read the Markdown in Obsidian or VS Code without Sourcefold.
- `sourcefold.json` holds what the Markdown can't carry exactly: a format version, the group tree in order, every source's row (kind, url, title, author, dates, position, X thread structure), notes, highlights with their anchors, tags, keep/maybe/cut, summaries, author type, cards, outline sections and script, b-roll clips. Each source points at its `.md` by path. Ids in the file are the old ids; import gives everything new ids and rewires highlights, cards and outline to them.
- Highlights land in the same place after import because the body text is identical.

### How it's built

- The work happens in the browser or the desktop app, not on Vercel: Vercel refuses request bodies over 4.5 MB and cuts long functions off.
  - **Website:** export asks the existing content route for each file and streams them into a zip (`fflate`, new dependency). Import unzips in the browser, creates groups and sources through the API, uploads text through the normal save path (so it reaches the importer's Drive as usual) and images through signed upload URLs.
  - **Desktop:** Rust does both (`zip` crate, new dependency). Offline it reads and writes SQLite and `Documents/Sourcefold` directly; signed in it goes through the web API like the website.
- A shared builder for the manifest in `packages/core/src/project-file/` (types, zod schema, version checks), so the website, desktop and MCP read and write the same thing. Golden test files pin the format, as for `docs/FILE-FORMAT.md`.
- Imports treat the file as untrusted: the manifest is checked with zod, paths with `..` or absolute paths are refused, sizes are capped, only image and mp4 types are accepted for media, and Markdown goes through the same sanitizing as any saved source.
- Claude (MCP) gets `export_project` and `import_project` later; not in the first cut.

## Part B: shared projects

### Who can share with whom

- Sharing works between people signed in to the same Sourcefold website. The owner's website lets any Google account in (`ALLOWED_EMAIL=*`), so a friend just signs in there. Someone running their own copy of Sourcefold can't join; they get a project file instead.
- **Inviting:** project menu → **Share**. Type the friend's email, or copy an invite link (random, expires after 7 days, can be cancelled). The friend opens it, signs in with Google, and the project appears in their switcher marked "Shared", with everyone's initials.
- **Roles:** "Can edit" and "Can view", chosen per person; the owner can change a role, remove someone, or stop sharing. Anyone can leave.
- **Who may start sharing:** R2 has no spending cap, and anyone can sign in to the owner's website, so only emails on a `SHARING_ALLOWED_EMAIL` list can make a project shared. Anyone they invite can join (and edit, if given "Can edit").
- Shared projects need the account. The offline desktop app can't open them (it can import a project file instead).

### What's shared

Everything in the project: groups and subgroups, sources, their text and images, X threads, notes, highlights (each shows who made it), tags, keep/maybe/cut, summaries, author type, cards, outline, script and b-roll. Rows show who added a source.

Not shared (each person keeps their own): which group is open, filters, reader settings, the extension's last-used group, the desktop's search index.

### Where things live

| What                                               | Personal projects (today)                                | Shared projects                   |
| -------------------------------------------------- | -------------------------------------------------------- | --------------------------------- |
| Folders, sources, notes, highlights, tags, cards…  | Supabase                                                 | Supabase (same tables)            |
| Source text, post images, X media, uploaded images | Google Drive (text cleared from Supabase after the push) | R2                                |
| Google Doc and Drive `.md` copies                  | Owner's Drive                                            | Each member's own Drive (phase 5) |
| Desktop local copy and search                      | `Documents/Sourcefold`                                   | same, for every member            |

- **R2 layout:** one private bucket. Objects are stored per project and named by a hash of their content: `projects/<project id>/blobs/<sha256>`. A changed source writes a new object and the old one stays, which is what makes "go back to an earlier version" possible. Text is stored gzipped (a 200 KB Grokipedia article is about 40 KB).
- **No R2 keys outside the server.** The website signs short-lived (15 minute) upload and download links for one object at a time, only after checking the person is a member (with edit rights for uploads). Browsers and the desktop upload and download straight to R2 with those links, which also avoids Vercel's 4.5 MB limit. Signing uses `aws4fetch` (new dependency, tiny).
- **Making an existing project shared** copies its text and images from the owner's Drive into R2 first (progress bar). **Stop sharing** turns it back into the owner's personal project: text and images are written back to the owner's Drive, the others lose access at once, and the R2 copy is deleted after 30 days.
- **Free plan limits:** 10 GB stored, 1 million writes and 10 million reads a month, downloads free. Supabase tracks the size of every object, Settings shows "R2: 1.2 GB of 10 GB", sharing warns at 8 GB and refuses new uploads at 9.5 GB so the bill stays at $0. Rough capacity: around 200,000 text-only articles, or a few thousand image-heavy Substack posts.

### Seeing each other's changes

- **Website:** Supabase Realtime pushes changes to the project's rows, so a source your friend adds, a group they rename or a highlight they make shows up within a second or two.
- **Desktop and Claude** don't hold a Supabase session (they use Sourcefold tokens), so they can't subscribe to Realtime directly. Two options, settled with a short test in phase 3: the website hands out a short-lived Supabase token for Realtime, or the desktop asks a cheap `GET /api/projects/<id>/changes?since=…` every ~10 seconds while its window is focused. The existing 30-second refresh stays as the fallback.
- **Editing the same thing at once:** Sourcefold's text is saved sources, not documents people type together, so there's no Google Docs-style typing in the same box. Each change is small and saved at once. If two people edit the same note, summary, script line or source text at the same moment, the second save is refused with "Ravi changed this while you were editing" and shows both versions. Nothing is overwritten silently. (Every update carries the version it started from.)

### History and going back

- Every change in a shared project is written to a `project_activity` table: who, when, what, and the before and after values. Database triggers write it, so changes from the website, desktop, extension and Claude are all caught. Requests made with a Sourcefold token run as the admin client, where Supabase doesn't know the user, so tracked tables get a `changed_by` column that every write sets.
- **History panel** (project menu → History, `g h`): "Ravi added 3 sources to Engines · 2 min ago", "You removed text from Turbocharger · yesterday", "Ravi deleted the group Old". Filter by person, group or source.
- **Going back:** every entry has **Undo**. Deleted sources and groups come back (they're soft-deleted today already), renames and moves are reversed, and a source's text, note or summary can be restored from **Versions** in the reader. An undo is itself a logged change, so it can be undone too.
- History is kept as long as the project exists. Old text versions are small; images are never stored twice.
- Later, if wanted: "Restore the project to how it was on <date>", built by undoing every change after that date.

### Security

- **Database rules:** today every row says "belongs to me" (`user_id = auth.uid()`). Shared projects need "my project, or a project I'm a member of", with edit rights checked for writes. Plan: a `project_members` table (the owner is a member too, so personal projects use the same rule), and a `project_id` column on `folders`, `items`, `x_posts` and `highlights` (filled by a trigger; `cards` and `outline_sections` have it already), so the rule is one cheap lookup.
- **Token routes are the risky part.** The desktop, extension and Claude go through routes that use the admin client, which skips the database rules; they filter by `user_id` by hand in about 116 places across 32 files, and 19 database functions take `p_user_id`. Each one must check project membership instead. To make this hard to get wrong: one helper (`requireProjectAccess(userId, projectId, "edit")`), a test that fails when a route queries these tables with a bare `user_id` filter, and a first look at whether token requests can run under the database rules with a short-lived Supabase token (which would remove the hand-written filters altogether).
- Viewers can't write anywhere (database rules and API).
- Removing someone stops their access at once. Files already on their computer (local copy, `.docx`, exports) stay; the remove dialog says so.
- `ALLOWED_EMAIL` still decides who can sign in; sharing never lets a stranger into someone's personal projects.

### Setup the owner does once

- A Cloudflare account with R2 turned on. Cloudflare may ask for a card or PayPal to turn R2 on even on the free plan; check when signing up. The 9.5 GB stop above is what keeps the bill at $0, because R2 has no spending cap of its own.
- One bucket, an API token limited to that bucket, and a CORS rule for the website's address.
- Vercel environment variables: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `SHARING_ALLOWED_EMAIL`. Without them the **Share** button doesn't show, so self-hosters who skip R2 lose nothing. `docs/SELF-HOSTING.md` gets the steps.
- A second Google account for testing.

## Order of work

1. **Project file** (Part A). Core manifest and golden files; website export and import; desktop export and import in both modes. Stands alone.
2. **Sharing foundation.** Migration: `project_members`, `project_invites`, `project_id` columns, `changed_by`, `project_activity` with its triggers (logging starts with the first shared change, even before the History panel exists), new database rules. Audit and rewrite every token route and database function. R2 storage for shared projects: signing route, upload and download in the content and save paths, size tracking and the 9.5 GB stop. Share dialog, invite links, "Shared" in the switcher on website, desktop, extension and Claude.
3. **Live updates.** Realtime on the website; the desktop's choice from the test; version checks on edits with the "changed while you were editing" message; who-added-this on rows.
4. **History.** History panel, Undo per change, Versions in the reader.
5. **Drive copies of shared projects:** each member's Drive gets the `.md` and Google Doc, so NotebookLM works for everyone. Needs per-person Drive state (`drive_copies`), since today one item has one `drive_file_id`.

## Decisions (owner, 2026-10-22)

1. **R2 holds shared projects only.** Each person's own projects stay in their Google Drive; the 10 GB is spent only on what's shared.
2. **Shared projects also go to each member's own Drive** (`.md` and Google Doc), so NotebookLM works for everyone. Built last (phase 5), after sharing works.
3. **Roles:** "Can edit" or "Can view", chosen per person and changeable.
4. **Only emails on `SHARING_ALLOWED_EMAIL` can make a project shared.** People they invite can join.

## Phase 2 design notes (2026-10-22, while building phase 1)

- **R2 is set up:** bucket `sourcefold-shared` exists on the owner's Cloudflare account with a CORS rule for the website, `localhost:3000` and the desktop webview (`http://tauri.localhost`, `tauri://localhost`). R2 was turned on without a card. Still to do by the owner: a bucket-scoped R2 API token (dashboard → R2 → Manage API tokens → Object Read & Write, bucket `sourcefold-shared`); the `cf` CLI login can't create tokens.
- **`user_id` keeps meaning "whose data this is".** In a shared project every row keeps the project owner's `user_id`, whoever made it; the person who made or changed a row goes in `created_by` / `changed_by`. So every existing `user_id` filter, Drive function and personal query keeps working for the owner, and only members who aren't the owner need the new membership path. A trigger sets `user_id` to the project owner on insert into a shared project.
- **Try running token requests under RLS first.** If the website can mint a short-lived Supabase JWT for the token's user (needs the project's JWT signing setup; check whether it uses the legacy secret or asymmetric keys), `requireApiUser` can hand token routes an RLS client instead of the admin client. Then the database rules are the one place membership is checked, and most of the 116 hand-written filters can go. Fall back to `requireProjectAccess` everywhere only if that isn't possible.
- **Project files already give every imported row a new id** (`remapProjectIds`); the same helper can make a "duplicate project" later.

When phase 2 lands, take "Accounts shared between people" out of the non-goals in `docs/dev/SPEC.md` and describe sharing there.
