# Text in R2, Drive as an optional backup, and shared projects

The owner asked (2026-11-05):

1. **Supabase keeps only the list** (links, titles, groups, notes, highlights), not article text. The `.md` text lives in **Cloudflare R2** and on each computer (`Documents/Sourcefold`). Other computers fetch it from R2.
2. **Google Drive is only a backup**, switched on or off at sign-in and in Settings.
3. **Teams**: different Google accounts work in the same project, like Notion. Join with a link or a code. Everyone sees everything in the project, live.
4. The same account on two computers keeps syncing (already built: `PLAN-sync.md`).

This file is the plan and the contract every part is built against. It replaces Part B of `PLAN-sharing.md` (R2 now holds every project's text, not only shared ones; anyone may share).

## How it works

```
 save on any device ──► Supabase row (+ text for a few seconds)
                              │
        device's sync step ───┼──► Content Worker ──► R2  items/<id>/text.md
                              │        (checks who you are with Supabase)
                              └──► Drive backup (only if switched on)

 other device / teammate ◄── "changed" signal (Realtime) ── reads list from Supabase,
                                                           text from the Worker (R2)
```

- **Who owns a row.** `user_id` stays "whose data this is". In a shared project every row carries the project owner's `user_id`, whoever made it (triggers set it); `created_by` records who made it. Members reach rows through `project_members`. Every database rule is "your own row, or a project you're in"; writes need "owner" or "editor".
- **Where text is.** `items.markdown` holds text only until it's copied out. A device uploads it to R2 and calls `mark_item_content_stored`, which clears it once R2 has it and (if the owner's Drive backup is on) Drive has it too. `markdown is null` means read it from R2; sources saved before this change are read from the owner's Drive until moved (`content_drive_only_items`).
- **The Worker** (`apps/content-worker`, Cloudflare `sourcefold-content`) is the only thing with R2 access (an R2 binding, no keys anywhere). It asks Supabase `content_access(item)` with the caller's own sign-in token, so the database decides who may read or write. The website's server uses a shared secret instead (`Authorization: Service …`), after checking access itself.
- **Live updates** reuse live sync: the database now also signals every member of the project (and the member themselves when they join or leave).

## Database (done: `supabase/migrations/20261107000000_r2_content_and_teams.sql`, applied 2026-11-05)

New columns: `folders.project_id`, `folders.created_by`, `items.project_id`, `items.created_by`, `items.content_sha256`, `items.content_bytes`, `items.content_at`, `drive_state.backup_enabled` (default on).
New tables: `project_members (project_id, user_id, role 'editor'|'viewer')`, `project_invites (code, role)` (8-character codes from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, shown as `K7QM-2XPD`; one active code per project and role; typing is case- and dash-insensitive).

Functions (all `rpc`):

| Function                                                                | Args                                                     | Returns                                                                                                                  | Notes                                                                                |
| ----------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `content_access`                                                        | `p_item_id`                                              | `{can_read, can_edit, kind, used_bytes}` or null                                                                         | used by the Worker                                                                   |
| `content_waiting_items`                                                 | `p_limit`, `p_user_id`                                   | items rows                                                                                                               | text (or image) that still has to go to R2, that this user may write                 |
| `content_drive_only_items`                                              | `p_limit`, `p_user_id`                                   | items rows                                                                                                               | owner's old sources whose only copy is in Drive                                      |
| `mark_item_content_stored`                                              | `p_id, p_seen_updated_at, p_sha256, p_bytes, p_user_id?` | boolean                                                                                                                  | true = cleared the Supabase copy (for an image: delete the Storage file now)         |
| `mark_item_saved_to_drive`                                              | `p_id, p_drive_file_id, p_seen_updated_at, p_r2`         | boolean                                                                                                                  | replaces `mark_item_stored_in_drive`; `p_r2` false only when no Worker is configured |
| `set_drive_backup`                                                      | `p_enabled`                                              | boolean                                                                                                                  | signed-in user only                                                                  |
| `get_project_invite` / `reset_project_invite` / `revoke_project_invite` | `p_project_id, p_role`                                   | code / code / –                                                                                                          | owner only                                                                           |
| `preview_project_invite`                                                | `p_code`                                                 | `{project_id, project_name, role, owner:{user_id,email,name,avatar_url}, member_count, your_role}` or null               |                                                                                      |
| `accept_project_invite`                                                 | `p_code`                                                 | project id                                                                                                               | idempotent; error `P0002` with a readable message for a bad code                     |
| `get_project_sharing`                                                   | `p_project_id`                                           | `{project_id, project_name, your_role, owner, members:[person + role + joined_at], invites:[{role, code}] (owner only)}` |                                                                                      |
| `set_project_member_role`                                               | `p_project_id, p_user_id, p_role`                        | –                                                                                                                        | owner only                                                                           |
| `remove_project_member`                                                 | `p_project_id, p_user_id`                                | –                                                                                                                        | owner removes anyone; anyone removes themself (leave)                                |
| `project_access`                                                        | `p_user_id?`                                             | rows `{project_id, your_role, owner_id, owner_name, owner_email, member_count}`                                          | every project that involves someone else                                             |

`p_user_id` rule: a signed-in client may pass only its own id (or nothing); the server's admin client (`sf_` tokens) must pass the user it acts for.
Changed: `drive_dirty_*` and `drive_unsaved_count` return nothing while the backup is off or Drive isn't connected; `folder_item_counts` counts shared projects; `soft_delete_folder` lets editors delete groups (only the owner deletes a project); the old `mark_item_stored_in_drive` never clears text.
Rules the database enforces: viewers can't write anything; only the owner renames, archives or deletes the project itself and manages members and codes; groups and sources don't move between projects with different owners.
Checks: `supabase/tests/teams_and_content_test.sql` (owner, editor, viewer, stranger, removal, leaving, marks, admin path) passed on the live database inside a rolled-back transaction.

## Content Worker contract (`apps/content-worker`)

Base URL: `https://sourcefold-content.writey.workers.dev` (config: `SOURCEFOLD_CONTENT_URL`).

| Request                   | Answer                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /health`             | `200 {"data":{"status":"ok"}}`                                                            |
| `GET /v1/items/{id}/text` | `200` body as `text/markdown; charset=utf-8`, `ETag: "<sha256>"`; `404` when R2 has none  |
| `PUT /v1/items/{id}/text` | body = UTF-8 Markdown, at most 10 MiB → `200 {"data":{"sha256","bytes"}}`                 |
| `GET /v1/items/{id}/file` | `200` bytes with the stored `Content-Type` (uploaded images)                              |
| `PUT /v1/items/{id}/file` | body = bytes, `Content-Type: image/*`, at most 25 MiB → `200 {"data":{"sha256","bytes"}}` |

- Auth: `Authorization: Bearer <Supabase access token>` → the Worker calls `POST {SUPABASE_URL}/rest/v1/rpc/content_access` with that token. Null → `404`; PUT without `can_edit` → `403`; token refused by Supabase → `401`. Or `Authorization: Service <SERVICE_SECRET>` (constant-time compare) → full access; only the website's server holds it.
- Errors: `{"error":{"message","code"}}`, codes `bad_request`, `unauthorized`, `forbidden`, `not_found`, `too_large`, `storage_full`, `method_not_allowed`. `{id}` must be a UUID.
- Free-plan stop: PUT refused with `507 storage_full` when `used_bytes + size > 9.5 GB` (Bearer path; R2's free plan is 10 GB).
- R2 keys: `items/{id}/text.md`, `items/{id}/file`. SHA-256 is of the exact stored bytes, lowercase hex.
- CORS: `Access-Control-Allow-Origin: *` (no cookies; every request carries its own token), methods `GET, PUT, OPTIONS`, headers `Authorization, Content-Type`, exposes `ETag`.

## Client library contract (`packages/client`)

- `Host` gains `content: ContentStore | null` (null = no Worker configured: everything behaves as before R2, Drive stays the store).
  ```ts
  interface StoredContent { sha256: string; bytes: number }
  interface ContentStore {
    getText(itemId: string): Promise<string | null>;          // null on 404
    putText(itemId: string, body: string): Promise<StoredContent>;
    getFile(itemId: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
    putFile(itemId: string, bytes: Uint8Array, mimeType: string): Promise<StoredContent>;
  }
  createWorkerContentStore({ baseUrl, authorization: () => Promise<string | null>, fetch? }): ContentStore
  ```
  Errors throw `ContentStoreError { status, code, message }`.
- `LocalApiDeps.contentUrl?: string`: `createLocalApi` builds the store with `Bearer <session access token>`.
- `loadItemBody(db, host, userId, item)`: `markdown` → R2 → (owner only) legacy Drive → `""` when it never had text. Every reader of a source's text uses it (content route, Drive save, project export, merge, remove text, TL;DRs, MCP).
- The automatic push (`createDrivePusher` in apps, `pushToDriveSoon` on the website) first runs `runContentBatch` (waiting text and images to R2, then old Drive-only sources while Drive is connected), then the Drive backup only when `drive_state.backup_enabled` is true (missing row = on).
- **Shared rows**: session (RLS) clients no longer filter project data by `user_id`; the database rules decide. Drive code and personal tables (`api_tokens`, `drive_state`, `google_tokens`, `shelf_links`, `link_queue`) keep their `user_id` filters. The website's `sf_` token path wraps its admin client with `scopeToUser(admin, userId)`, which adds `user_id = <user>` to every select, update and delete, so token users only ever reach their own rows (shared projects need a signed-in app).
- Write refused by the database (`42501`, "row-level security", "not allowed") → `403 "You can view this project but not change it."` from the shared router and the website's route wrapper.

### New API routes (same on the website and in the apps)

| Route                                          | Body        | Answer                                              |
| ---------------------------------------------- | ----------- | --------------------------------------------------- |
| `GET /api/projects/{id}/sharing`               |             | `{data: Sharing}` (shape of `get_project_sharing`)  |
| `POST /api/projects/{id}/invite`               | `{role}`    | `{data:{code, role}}`                               |
| `POST /api/projects/{id}/invite/reset`         | `{role}`    | `{data:{code, role}}`                               |
| `DELETE /api/projects/{id}/invite?role=editor` |             | `{data:{ok:true}}`                                  |
| `PATCH /api/projects/{id}/members/{userId}`    | `{role}`    | `{data:{ok:true}}`                                  |
| `DELETE /api/projects/{id}/members/{userId}`   |             | `{data:{ok:true}}` (remove, or leave when it's you) |
| `GET /api/invites/{code}`                      |             | `{data: Preview}` or `404`                          |
| `POST /api/invites/{code}/accept`              |             | `{data:{project_id}}`                               |
| `GET /api/settings/backup`                     |             | `{data:{enabled, connected}}`                       |
| `PUT /api/settings/backup`                     | `{enabled}` | `{data:{enabled}}`                                  |

Sharing routes answer `403` for `sf_` tokens ("Sharing needs the Sourcefold app or website."). `GET /api/drive/status` adds `backup_enabled`. `GET /api/folders` (and `loadFolders`) adds, on a project that involves someone else, `sharing: { role: "owner"|"editor"|"viewer", owner_name, owner_email, member_count }`. The mirror manifest (local copy) includes shared projects; a shared project whose name clashes with another visible project gets ` (shared)` appended in its folder path.

Invite links: `https://<website>/join/<CODE>`. Apps accept either the link or the code.

## UI (website and desktop; follow `docs/dev/DESIGN.md`, keep the current look)

- **Project menu → Share project…** (owner): people (name, email, role menu Can edit / Can view, Remove), invite section: "Anyone with this link can join as an editor" + link + code `K7QM-2XPD` + Copy link + Copy code; a switch for a separate view-only link; **New link** (old one stops working), **Turn off link**. Non-owners: "Shared by <owner>", the people list, **Leave project**.
- **Project switcher**: shared projects show a small people icon and "Shared" (owner) or "by <owner name>"; a **Join a shared project…** entry opens a dialog: paste link or code → preview ("<Project>, shared by <owner>, 3 people, you'll join as an editor") → **Join** → switches to it.
- **Website `/join/<code>`**: signed-out visitors sign in first and come back; then the same preview and **Join**.
- **Settings → Backup**: "Back up to Google Drive" switch with one line: "Your library always lives in your Sourcefold account. With this on, Sourcefold also copies every source into a Sourcefold folder in your Google Drive." While off, the Save to Drive button, its shortcut and the unsaved count are hidden.
- **Desktop first sign-in** (Welcome): a checkbox "Also back up my library to Google Drive", on by default; its value is sent with `PUT /api/settings/backup` right after sign-in.
- Viewers: write actions fail with the 403 message in the usual error toast (no separate read-only mode in this version).

## Config

| Where           | Name                                                  | Value                                                                                       |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Worker vars     | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`            | the live project                                                                            |
| Worker secret   | `SERVICE_SECRET`                                      | random, also in Vercel                                                                      |
| Vercel          | `SOURCEFOLD_CONTENT_URL`, `SOURCEFOLD_CONTENT_SECRET` | Worker URL, the same secret                                                                 |
| Desktop build   | `VITE_SOURCEFOLD_CONTENT_URL`                         | Worker URL (`.env.local`, GitHub variable `SOURCEFOLD_CONTENT_URL` in the release workflow) |
| Extension build | `WXT_SOURCEFOLD_CONTENT_URL`                          | same                                                                                        |
| MCP             | `content_url` in the desktop's `session.json`         | same                                                                                        |

Without the Worker URL an app keeps the old behaviour (text to Drive), so self-hosters who skip R2 lose nothing.

## Limits

- R2 free plan: 10 GB stored, 1 M writes and 10 M reads a month; Workers free plan: 100,000 requests a day. A first local copy of a 1,000-source library is about 1,000 requests.
- X post text (`x_posts`), notes and the remove-text undo history stay in Supabase (small).
- Text waits in Supabase while the owner's Drive backup is on but behind (for example their computer is off and a member saved through the website), until the next Drive save.
- Uploaded images by a member stay in that member's Storage folder until their device moves them to R2 (seconds); others see them after that.
- Shared projects aren't available through `sf_` access tokens, only through signed-in apps, the website and Claude's connectors.
- No history/undo log for shared projects yet (`PLAN-sharing.md` phase 4), and no copy in each member's Drive (phase 5).
