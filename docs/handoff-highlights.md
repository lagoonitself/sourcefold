# Highlights: build contract (phase 1)

This is the contract between the agents building phase 1 of `docs/PLAN-reader-search.md`. Every agent reads this file, `AGENTS.md`, `docs/DESIGN.md` (UI work) and its own brief. If something here is unclear, stop and report; don't invent a different shape.

## Owner's decisions (2026-10-17)

- Highlights live in the database (Supabase signed in, SQLite offline) **and** in the source's own `.md` file, as a `## My highlights` section, so any Markdown app (Obsidian, VS Code) can read them. The database is the source of truth; the section is rebuilt from it.
- Selecting text highlights it by default. Holding `Alt` while selecting selects without highlighting. A switch in the reader turns automatic highlighting off (`localStorage` key `sourcefold:reader:autoHighlight`, default on).
- The web app doesn't show highlights in phase 1. It stores them, serves them, and writes them into the Drive file.

## Data shape

TypeScript, in `packages/core/src/highlights.ts`, exported from `@sourcefold/core`:

```ts
export type HighlightKind = "text" | "image";

/** A reference cited inside the highlighted passage (Grokipedia / Wikipedia footnote). */
export interface HighlightCitation {
  n: string; // footnote label, e.g. "12"
  title: string | null;
  url: string;
}

export interface Highlight {
  id: string; // uuid, made by the client
  item_id: string;
  kind: HighlightKind;
  quote: string; // the highlighted text; for an image, its alt text
  prefix: string; // up to 32 characters of body text before the quote
  suffix: string; // up to 32 characters after
  start_offset: number; // offsets into the reader's rendered body text (see "Anchoring")
  end_offset: number;
  image_src: string | null; // image highlights only
  note: string | null;
  seconds: number | null; // YouTube: start of the transcript line the highlight begins in
  cited: HighlightCitation[];
  created_at: string; // ISO timestamp
  updated_at: string;
}

/** What the client sends to create or replace a highlight. */
export type HighlightInput = Omit<Highlight, "created_at" | "updated_at">;
```

Limits (validate on the server and in Rust): `quote` up to 10,000 characters, `note` up to 5,000, `prefix`/`suffix` up to 64, `cited` up to 50 entries, offsets are non-negative integers with `end_offset >= start_offset`, `seconds` a non-negative integer or null.

## Supabase

Migration `supabase/migrations/20261017000000_highlights.sql`:

- Table `public.highlights` with the columns above (`cited jsonb not null default '[]'`, `kind text check (kind in ('text','image'))`), `user_id uuid not null` referencing `auth.users` with `on delete cascade`, `item_id` referencing `public.items(id)` with `on delete cascade`.
- Index on `(user_id, item_id)`.
- RLS on, one policy per action, all `user_id = (select auth.uid())`; insert/update also check the item belongs to the same user.
- Trigger: after insert, update or delete on `highlights`, set `items.updated_at = now()` for the affected item. That marks the item "needs saving to Drive" (`updated_at > drive_synced_at`) and changes its local-copy version, so the Drive file and the desktop's local copy pick up the new `## My highlights` section with no other change.

## Web API

Token routes use `requireApiUser` with the admin client, so every query filters by `user_id` (see HANDOFF lessons). Responses use `jsonData` / `jsonError`.

| Method and path                   | Body                                   | Returns                                                 |
| --------------------------------- | -------------------------------------- | ------------------------------------------------------- |
| `GET /api/highlights?item=<id>`   |                                        | `Highlight[]` of that item                              |
| `GET /api/highlights?folder=<id>` |                                        | `Highlight[]` of the live items directly in that folder |
| `PUT /api/highlights/<id>`        | `HighlightInput` (the `id` must match) | `Highlight` (created or replaced)                       |
| `PATCH /api/highlights/<id>`      | `{ note: string \| null }`             | `Highlight`                                             |
| `DELETE /api/highlights/<id>`     |                                        | `{ id }`                                                |

Lists are ordered by `item_id`, then `start_offset`, then `created_at`. `PUT` with an id that belongs to another user is a 404. Deleting is a hard delete; undo in the desktop re-sends the same `PUT`.

## Desktop (Tauri, offline mode)

SQLite table `highlights` with the same columns (`cited` stored as JSON text). Commands, arguments in camelCase as Tauri sends them, results with the snake_case fields of `Highlight`:

| Command                 | Arguments                                | Returns       |
| ----------------------- | ---------------------------------------- | ------------- |
| `list_highlights`       | `{ itemId?: string, folderId?: string }` | `Highlight[]` |
| `put_highlight`         | `{ highlight: HighlightInput }`          | `Highlight`   |
| `update_highlight_note` | `{ id: string, note: string \| null }`   | `Highlight`   |
| `delete_highlight`      | `{ id: string }`                         | `null`        |

After each change the item's `updated_at` moves and its file on disk is rewritten with the new `## My highlights` section. Deleting an item deletes its highlights.

## Desktop client (`apps/desktop/src/lib/api.ts`)

Already written by the orchestrator; use these, don't add others:

```ts
getHighlights(scope: { itemId: string } | { folderId: string }): Promise<Highlight[]>
putHighlight(highlight: HighlightInput): Promise<Highlight>
updateHighlightNote(id: string, note: string | null): Promise<Highlight>
deleteHighlight(id: string): Promise<void>
```

## File format: `## My highlights`

Added to `docs/FILE-FORMAT.md`; both builders (`packages/core` `buildItemFile`, desktop `build_item_file`) produce it byte for byte, checked by the golden pair `packages/core/test/golden/item-with-highlights.{input.json,md}`.

- The section comes after the body and before `## My note`. It is left out when there are no highlights.
- Highlights are listed by `start_offset`, then `created_at`, then `id`.
- Each highlight is one block; blocks are separated by one blank line:
  - Text: `> ` followed by the quote with every run of whitespace (including line breaks) collapsed to one space and trimmed.
  - Image: `![<quote, whitespace collapsed>](<image_src>)`.
- If the highlight has any details, one more line follows its block (after a blank line), with the parts that apply joined by `·`, in this order:
  1. Timestamp, when `seconds` is set: `[<time>](https://youtu.be/<video id>?t=<seconds>)`. `<time>` is `M:SS` under an hour, `H:MM:SS` from an hour (the transcript's own format). The video id comes from the item's URL (`watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`); without one, the time is written as plain text.
  2. Citations, when `cited` is not empty: `Cited: ` then each as `[<domain>](<url>)` joined by `, `. `<domain>` is the URL's host without a leading `www.`. A URL containing a space or a parenthesis is written `<url>` inside the parentheses, as the references list does.
  3. Note, when set: `Note: ` then the note with whitespace collapsed to one space.
- The reader and `bodyFromDriveFile` cut the section off the body (search for the last `\n## My highlights\n` after removing `## My note`), so the body and the highlight offsets never include it.

Example (YouTube item `https://www.youtube.com/watch?v=abcDEF12345`):

```markdown
## My highlights

> The exhaust spins a turbine, and the turbine drives a compressor.

[0:47](https://youtu.be/abcDEF12345?t=47) · Note: Intro line for the script

![Cutaway of a turbocharger](https://example.com/turbo.png)

> Turbo lag was the main obstacle to early adoption.

Cited: [sae.org](https://www.sae.org/paper) · Note: Check the date
```

Parts are joined by `·`; several citations inside the Cited part are joined by `, `.

## Copy formats (`packages/core/src/highlights.ts`)

```ts
export interface CopySource {
  title: string;
  byline: string[]; // e.g. ["Engineering Explained", "YouTube"]
  url: string | null;
}
export function copySourceFromItem(item: {
  kind: string;
  title: string;
  source_url?: string | null;
  canonical_url?: string | null;
  meta?: Record<string, unknown> | null;
}): CopySource;
export function formatHighlightTime(seconds: number): string; // "0:47", "1:02:05"
export function youtubeTimestampUrl(
  itemUrl: string | null | undefined,
  seconds: number,
): string | null;
export function formatQuoteWithSource(highlight: Highlight, source: CopySource): string;
export function formatQuotesWithSources(
  entries: { highlight: Highlight; source: CopySource; itemId: string }[],
): string;
```

- `byline`: YouTube `[channel, "YouTube"]`; Substack `[author, publication or "Substack"]`; Grokipedia `["Grokipedia"]`; Wikipedia `["Wikipedia"]`; X `[author, "X"]`; web `[author, site or host]`; Reddit `["r/<subreddit>"]` or `["Reddit"]`; PDF `[author, "arXiv"]` when `arxiv` is set, else `[author, host]`; Hacker News `[author, "Hacker News"]`; Bluesky `[author, "Bluesky"]`; note `["Note"]`. Empty parts are dropped.
- One quote:

  ```text
  > <quote>

  — <title>, <byline joined by ", ">, at <time>. <url>
  ```

  `, at <time>` only with `seconds`, and then `<url>` is the timestamp URL. Without a URL, the line ends after the period. Image highlights use `![<alt>](<src>)` instead of the quote line.

- Several quotes: each quote block followed by ` [<n>]` on its last line (` [<n>, <time>]` with a timestamp), blocks separated by a blank line, then a blank line, `Sources`, and one line per source: `<n>. <title>, <byline>. <url>`. Sources are numbered by first appearance; the same item keeps its number.

## Anchoring (desktop reader)

- Offsets count characters of `textContent` of the reader's rendered **body** element only (not the header, not the note, not `## My highlights`), walking text nodes in document order.
- To place a highlight: if the text at `start_offset..end_offset` equals `quote`, use it; otherwise search for `prefix + quote + suffix`, then `quote` alone, nearest to `start_offset`; if nothing matches, the highlight is listed in the panel as "Couldn't find this passage in the current text" and not marked.
- Image highlights anchor by `image_src`.

## Keys

Reader (handled in `ReaderModal`, listed in the shortcuts registry and the `?` sheet):

| Key                                              | Action                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `j` / `k`                                        | Move the paragraph focus down / up (scrolls it into view)          |
| `ArrowDown` / `ArrowUp`, `Space` / `Shift+Space` | Scroll, as today                                                   |
| `h`                                              | Highlight the selection, or the focused paragraph or image         |
| `n`                                              | Note on the current highlight                                      |
| `c`                                              | Copy the current highlight with its source                         |
| `Backspace` / `Delete`                           | Delete the current highlight                                       |
| `z` / `Mod+Z`                                    | Undo the last highlight change                                     |
| `Shift+H`                                        | Show or hide the side panel                                        |
| `[` / `]`                                        | Previous / next source in the group                                |
| `o`                                              | Open the original (as today)                                       |
| `Escape`                                         | Close the small menu, then the panel's note field, then the reader |

The "current highlight" is the one just made, clicked, or under the focused paragraph.

Group list region: `Shift+H` switches between the **Sources** and **Highlights** tabs.
