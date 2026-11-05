# Link Shelf

The owner asked (2026-11-05) for a place to keep the sites they visit often, each with a note, without bookmarking them in Chrome and without downloading the page as a source. This file is the plan and the contract every agent builds against.

## What it is

A shelf link is a URL with a title, a note, tags, a pin and how often it was opened. Unlike a source, nothing is downloaded: no Markdown file, no Drive copy, no group. The shelf belongs to the account, not to a project; tags do the sorting.

## Where it shows

- **Desktop app:** a **Shelf** row at the top of the sidebar (above the project picker, lucide `BookMarked`); `Mod+Shift+L` opens it. The shelf view fills the sheet: heading "Shelf" (same highlighted heading as a group), a filter field, tag chips, then rows. Pinned links first, then by use (below). Each row: site tile (first letter of the host on a 12% ink tile; no favicon fetching, which would tell Google every site), title in Newsreader, host and the first line of the note in muted text, tags, "Opened 3 days ago". Click opens the link in the browser and counts the open. Row menu: Edit, Pin/Unpin, Copy link, Save as a source (opens Add links with the URL), Delete.
- **Add to shelf dialog** (`Mod+L` anywhere, and a button in the shelf view): URL, title (filled from the URL's host until the user types), note (textarea), tags (comma separated). Pasting several URLs (one per line) in the URL field adds them all with empty notes.
- **Import:** in the shelf view's menu, "Import bookmarks…" reads a Chrome/Edge/Firefox `bookmarks.html` export and adds every link (folder names become tags), skipping ones already on the shelf.
- **Command palette (`Mod+K`):** shelf links are listed under "Shelf"; Enter opens the link.
- **Chrome extension popup:** next to **Save**, a **Shelve** button adds the current tab (title from the tab, optional note field that appears after shelving). When the current tab is already on the shelf, the popup shows its note and "On your shelf".
- **Extension icon dot:** when the current tab's site is on the shelf with a note, the toolbar icon shows a small badge (`•`) so the user knows there's a note.

## Ordering ("most used")

`score = (pinned ? 1e9 : 0) + open_count * 0.5^(days since last_opened_at / 14)`. Links never opened sort by `created_at`, newest first, after the opened ones. Computed in the client (`shelfScore` in core).

## Contract

### Core (`packages/core/src/shelf.ts`, exported from the index)

```ts
export interface ShelfLink {
  id: string;
  url: string;
  key: string; // shelfKey(url): duplicate detection
  title: string;
  note: string;
  tags: string[];
  pinned: boolean;
  open_count: number;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface ShelfLinkInput { url: string; title?: string; note?: string; tags?: string[]; pinned?: boolean }
export interface ShelfLinkPatch { url?: string; title?: string; note?: string; tags?: string[]; pinned?: boolean }
export const SHELF_LIMITS = { url: 2048, title: 300, note: 8000, tags: 20, tag: 40, batch: 500 };
export function shelfKey(url: string): string | null;   // http(s) only; lowercase host minus www., no hash, no trailing slash, query kept
export function shelfTitleFallback(url: string): string; // the host minus www.
export function normalizeShelfTags(tags: unknown): string[]; // trim, drop "#", collapse spaces, dedupe case-insensitively, limits
export function shelfScore(link: ShelfLink, now?: Date): number;
export function sortShelf(links: ShelfLink[], now?: Date): ShelfLink[];
export function parseBookmarksHtml(html: string): { url: string; title: string; tags: string[] }[];
```

### HTTP API (Supabase via `@sourcefold/client`, and the desktop's offline loopback server)

- `GET /api/shelf` → `{ data: ShelfLink[] }` (unsorted; the client sorts).
- `POST /api/shelf` body `ShelfLinkInput | { links: ShelfLinkInput[] }` → `{ data: { added: ShelfLink[], existing: ShelfLink[] } }`. A link whose key is already on the shelf is not changed and comes back in `existing`.
- `PATCH /api/shelf/<id>` body `ShelfLinkPatch` → `{ data: ShelfLink }`; 409 if the new URL's key belongs to another link.
- `DELETE /api/shelf/<id>` → `{ data: { id } }`.
- `POST /api/shelf/<id>/open` → `{ data: ShelfLink }` (open_count + 1, last_opened_at now).

Errors: `{ error: { message } }`, 400 for bad input, 404 unknown id.

### Desktop (offline): Tauri commands

`list_shelf() -> ShelfLink[]`, `add_shelf_links(links: ShelfLinkInput[]) -> { added, existing }`, `update_shelf_link(id, patch) -> ShelfLink`, `delete_shelf_link(id)`, `open_shelf_link(id) -> ShelfLink`. The loopback server answers the same HTTP API for the extension when the desktop is offline.

### Desktop webview: `apps/desktop/src/features/shelf/shelf-api.ts`

`listShelf()`, `addShelfLinks(inputs)`, `updateShelfLink(id, patch)`, `deleteShelfLink(id)`, `recordShelfOpen(id)`: Tauri commands offline, `/api/shelf` through the local API when signed in (same split as `tldr-api.ts`).

## Storage

- Supabase `shelf_links` (migration `20261105000000_shelf_links.sql`), RLS own-rows, unique `(user_id, key)`.
- SQLite `shelf_links` with the same columns (`tags` as JSON text), unique `key`.

## Work split

| Part | Who | Files |
| --- | --- | --- |
| Core types and helpers, tests | orchestrator | `packages/core/src/shelf.ts`, test |
| Migration, client routes, web route wrappers | orchestrator | `supabase/migrations/…`, `packages/client/src/routes/shelf*`, `packages/client/src/features/shelf/`, `apps/web/src/app/api/shelf/**` |
| SQLite store, Tauri commands, loopback routes | orchestrator | `apps/desktop/src-tauri/src/shelf_store.rs`, `commands/shelf.rs`, `server.rs`, `db.rs`, `lib.rs` |
| Desktop shelf API and UI | Haiku agent A | `apps/desktop/src/features/shelf/**`, wiring lines in `App.tsx`, `AppSidebar.tsx`, `CommandPalette.tsx` |
| Extension Shelve button and badge | Haiku agent B | `apps/extension/entrypoints/popup/ShelfPanel.tsx`, `apps/extension/lib/shelf.ts`, wiring in `popup/App.tsx`, `background.ts` |

## Later

Dead-link check, Obsidian `Links.md` export, shelf links in Claude's MCP tools, notes that show on the page itself.
