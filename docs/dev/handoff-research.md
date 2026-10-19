# Research tools: build contract

The owner researches YouTube videos with Sourcefold and Claude (through the MCP server) and asked, on 2026-10-19, for seven features so triage and writing happen in Sourcefold instead of in chat:

5. **Keep / maybe / cut** on each source, plus **tags** for outline sections.
6. A **short summary** saved on each source.
7. **Quote cards**: turn a highlight into a card with its exact source and video timestamp, then drag cards into an **outline**.
8. A **script view** with citations, each line linking back to its card, plus an **export of the reference list**.
9. A **duplicate check across groups** (the owner saved METR's chart and Epoch's 2030 report twice in different groups).
10. **Who wrote it**: the author and an author type (lab, researcher, journalist, forum, …) on each source.
11. A **b-roll list** of video timestamps for clips to show.

Every agent reads this file, `AGENTS.md`, its brief, and (UI work) `docs/dev/DESIGN.md`. The shared code is already written: `packages/core/src/research.ts` (types, limits, author-type guess, script/reference/b-roll exports, duplicate finder; tested in `research.test.ts`). Use it; don't reimplement any of it. If something here is unclear or wrong, stop and report rather than inventing another shape.

## Decisions (orchestrator, 2026-10-19)

- **Tags are outline section names.** A tag is free text on a source. The outline's sections are named; the tag picker suggests the project's section titles first, then tags already used in the project. Renaming a section renames that tag on every source in the project. Deleting a section keeps the tags.
- **Cards** live in a project, not in a group. A card is a `quote` (from a source, usually a highlight), a `broll` clip, or a `line` (a script line the user writes, no source). Cards wait in the **card pile** (`section_id = null`) until dragged into a section. The **script** is the outline read top to bottom: each placed card is one line, cited with a reference number.
- A card made from a highlight copies the quote and time; deleting the highlight keeps the card (`highlight_id` becomes null). Deleting a source deletes its cards (cascade).
- **Soft deletes (added in review):** sources and groups are soft-deleted (`deleted_at`), so the cascade only fires on a hard delete. Every card list (web `GET /api/cards`, Rust `list_cards`) leaves out cards whose `item_id` points at a source that is soft-deleted or sits in a soft-deleted group; they come back if the source is restored. Line cards (`item_id` null) are always listed. Merge moves cards before deleting the others, so merged cards stay visible.
- **B-roll clips are cards** (`kind: "broll"`), so they can also be placed in the outline. The b-roll list shows every clip in the project.
- **Summary, status, tags, author, author type** are columns on `items`, written into the source's file (below). Sourcefold never writes summaries itself; the user types them or Claude writes them through the MCP.
- **Author type** set by a person or Claude is stored. When none is stored, the app shows `guessAuthorType` (from the kind and the address) as a guess, in muted text with "(guess)". Guesses are never written to the database or the file.
- **Duplicates across groups:** a link already saved anywhere in the same project is refused with "Already saved in <Group path>." (groups joined by `/`, without the project name). Every client already treats a message matching `/already saved/i` as a duplicate. `allow_duplicate: true` in the request body saves it anyway (only the MCP offers this). Projects stay separate: another project's copy doesn't count. For copies already saved, the **Duplicates** view lists `findDuplicateSets` results and offers **Keep this one**, which merges the others into it (below).
- **Signed in and offline** both get every feature. The web app gets the API only (no new web pages), like highlights.

## Data shape

TypeScript in `packages/core/src/research.ts`, exported from `@sourcefold/core`: `Triage`, `AuthorType`, `ItemResearchFields`, `ItemResearchPatch`, `RESEARCH_LIMITS`, `normalizeTags`, `Card`, `CardInput`, `CardPatch`, `CARD_LIMITS`, `cardProblem`, `OutlineSection`, `OutlineSectionInput`, `SECTION_TITLE_MAX`, `sortSections`, `sortCards`, `positionBetween`, `formatClipTime`, `parseClipTime`, `cardLink`, `youtubeThumbnailUrl`, `sourceAuthor`, `guessAuthorType`, `effectiveAuthorType`, `scriptSourceFromItem`, `buildScript`, `buildReferenceList`, `buildBrollList`, `orderBrollClips`, `findDuplicateSets`, plus the label maps.

Validation (server and Rust): `triage` one of `keep`, `maybe`, `cut` or null; `tags` through `normalizeTags`, at most 20; `summary` at most 5,000 characters (empty string clears it); `author` at most 200 (empty clears); `author_type` one of `AUTHOR_TYPES` or null. Cards: `cardProblem(card)` must return null; the card's `project_id` must be a project (top-level folder) of the user; its `item_id` (if any) must be a live source inside that project; its `section_id` (if any) must be a section of the same project; its `highlight_id` (if any) must be a highlight of `item_id`. Sections: title trimmed, 1–200 characters; `position` finite.

## Supabase

Migration `supabase/migrations/20261019000000_research_tools.sql`:

- `items`: add `triage text check (triage in ('keep','maybe','cut'))`, `tags text[] not null default '{}'` (check `cardinality(tags) <= 20`), `summary text check (char_length(summary) <= 5000)`, `author text check (char_length(author) <= 200)`, `author_type text check (author_type in (…AUTHOR_TYPES))`. Changing them goes through the normal `items` update, so `updated_at` moves and Drive and the local copy rebuild the file.
- `outline_sections`: `id uuid pk default gen_random_uuid()`, `user_id` (default `auth.uid()`, references `auth.users` on delete cascade), `project_id uuid not null references folders(id) on delete cascade`, `title text not null` (check trimmed length 1–200), `position double precision not null default 0`, `created_at`, `updated_at` (with the `set_updated_at` trigger).
- `cards`: `id uuid pk`, `user_id`, `project_id` (references `folders` on delete cascade), `kind text not null check (kind in ('quote','broll','line'))`, `item_id uuid references items(id) on delete cascade`, `highlight_id uuid references highlights(id) on delete set null`, `quote text not null default ''` (≤ 10,000), `seconds integer` (≥ 0), `end_seconds integer` (≥ `seconds`), `url text` (≤ 2,000), `note text` (≤ 5,000), `script_line text` (≤ 5,000), `section_id uuid references outline_sections(id) on delete set null`, `position double precision not null default 0`, `created_at`, `updated_at`.
- Indexes on `(user_id, project_id)` for both tables, and on `cards(item_id)`, `cards(section_id)`, `cards(highlight_id)` for the cascades.
- RLS on, one policy per action, `user_id = (select auth.uid())`, like `highlights`. Cards and sections are not part of item files, so no trigger touches `items`.
- Regenerate `apps/web/src/lib/database.types.ts` for the new columns and tables (edit by hand in the generated shape if the CLI isn't available).

## Web API

Token routes use `requireApiUser` with the admin client: every query filters by `user_id`. Responses use `jsonData` / `jsonError`.

| Method and path                          | Body                                                      | Returns                                                                                                                                                             |
| ---------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/items?folder=<id>`             |                                                           | as today, plus `triage`, `tags`, `summary`, `author`, `author_type` on each item                                                                                    |
| `GET /api/items?project=<id>`            |                                                           | every live item in every group of the project (same columns, plus `folder_id`), ordered by `created_at`                                                             |
| `GET /api/items/<id>`                    |                                                           | as today, plus the five fields                                                                                                                                      |
| `PATCH /api/items/<id>`                  | also `triage`, `tags`, `summary`, `author`, `author_type` | as today (the patched item, with the five fields)                                                                                                                   |
| `POST /api/items/<keep id>/merge`        | `{ ids: string[] }` (1–20, same project)                  | `{ item: Item, moved_highlights: number, moved_cards: number }`                                                                                                     |
| `POST /api/items/check`                  | as today                                                  | as today, plus `elsewhere: { item_id, folder_id, folder_path } \| null`: the same link in another group of the project                                              |
| `GET /api/cards?project=<id>`            |                                                           | `Card[]` of the project                                                                                                                                             |
| `GET /api/cards?item=<id>`               |                                                           | `Card[]` made from that source                                                                                                                                      |
| `PUT /api/cards/<id>`                    | `CardInput` (the `id` must match)                         | `Card` (created or replaced)                                                                                                                                        |
| `PATCH /api/cards/<id>`                  | `CardPatch`                                               | `Card`                                                                                                                                                              |
| `DELETE /api/cards/<id>`                 |                                                           | `{ id }`                                                                                                                                                            |
| `GET /api/outline-sections?project=<id>` |                                                           | `OutlineSection[]`, sorted with `sortSections`                                                                                                                      |
| `PUT /api/outline-sections/<id>`         | `OutlineSectionInput` (`id` must match)                   | `OutlineSection`; when the title changes, every source in the project tagged with the old title (`sameTag`) gets the new one instead, keeping its place in the list |
| `DELETE /api/outline-sections/<id>`      |                                                           | `{ id }` (its cards go back to the pile)                                                                                                                            |

- `PATCH /api/items/<id>` with `tags` runs `normalizeTags` and refuses more than 20 (400). `summary: ""` and `author: ""` mean null.
- **Merge** (`keep` and every id must be live sources of the user in the same project; the keep id can't be in `ids`): move highlights (`item_id`) and cards (`item_id`) from the others to `keep`; tags become the union (keep's first, `normalizeTags`); `triage`, `summary`, `author`, `author_type`, `note` are filled from the first other that has them when keep has none (notes are joined with a blank line when both have one and they differ); then the others are deleted the same way `DELETE /api/items/<id>` deletes. Ids that don't exist or are outside the project are a 404 and nothing changes.
- **Duplicates on save:** `POST /api/capture`, `POST /api/grokipedia`, `POST /api/wikipedia` and `POST /api/source` (whichever create sources; not `/api/x`, which appends posts to threads) refuse with 409 and `Already saved in <Group path>.` when the canonical URL is already a live source in another group of the same project, unless the body has `allow_duplicate: true`. The existing same-group refusal is unchanged. Put the lookup in one helper next to `findExistingItemByCanonicalUrl`.
- The `GET /api/mirror` / content routes need no change: the file builder gets the new fields from the item row (below).

## File format

Add to `docs/FILE-FORMAT.md`; `buildItemFile` (TypeScript) and `build_item_file` (Rust) produce it byte for byte, checked by a new golden pair `packages/core/test/golden/item-with-research.{input.json,md}` (a web page with all five fields, a highlight and a note).

- **Front matter:** after `folder` (every kind, notes included), in this order, each only when set: `written_by` (`author`), `author_type`, `status` (`triage`), `tags` (a YAML block list, the existing `string[]` form of `buildFrontMatter`). Notes never get `written_by` or `author_type`.
- **`## My summary`**: after the body and before `## My highlights`, the summary trimmed, as written (line breaks kept). Left out when there is none, and for notes.
- Strip it like the other trailing sections: `stripTrailingSections`/`bodyFromDriveFile` (TypeScript), the Rust equivalent, and the reader's file parser (`packages/core/src/reader`) cut `\n## My note\n`, then `\n## My highlights\n`, then `\n## My summary\n` (each the last occurrence), so bodies and highlight offsets never include it.
- `BuildItemInput` gains optional `triage`, `tags`, `summary`, `author`, `author_type`; the golden input JSON uses those names.

```markdown
---
source: web
title: Can AI scaling continue through 2030?
url: https://epoch.ai/blog/can-ai-scaling-continue-through-2030
site: Epoch AI
saved: 2026-10-19
folder: AI research/Compute
written_by: Epoch AI
author_type: lab
status: keep
tags:
  - Compute
  - Ending
---

# Can AI scaling continue through 2030?

> Saved from [Epoch AI](https://epoch.ai/blog/…) on 2026-10-19.

<body>

## My summary

Training runs of 2e29 FLOP are feasible by 2030; power is the binding constraint.

## My highlights

…

## My note

…
```

## Desktop (Tauri, offline mode)

SQLite: the five `items` columns (`tags` as JSON text, default `'[]'`), and `outline_sections` and `cards` tables with the columns above (`position` REAL). Deleting an item deletes its cards; deleting a highlight sets `highlight_id` null on cards; deleting a section sets `section_id` null; deleting a project deletes both. Commands (arguments camelCase, results snake_case like the web):

| Command                  | Arguments                                 | Returns                                      |
| ------------------------ | ----------------------------------------- | -------------------------------------------- |
| `list_project_items`     | `{ projectId }`                           | `Item[]`                                     |
| `update_item_research`   | `{ id, patch: ItemResearchPatch }`        | `Item`                                       |
| `merge_items`            | `{ keepId, ids }`                         | `{ item, moved_highlights, moved_cards }`    |
| `list_cards`             | `{ projectId?: string, itemId?: string }` | `Card[]`                                     |
| `put_card`               | `{ card: CardInput }`                     | `Card`                                       |
| `update_card`            | `{ id, patch: CardPatch }`                | `Card`                                       |
| `delete_card`            | `{ id }`                                  | `null`                                       |
| `list_outline_sections`  | `{ projectId }`                           | `OutlineSection[]`                           |
| `put_outline_section`    | `{ section: OutlineSectionInput }`        | `OutlineSection` (renames tags like the web) |
| `delete_outline_section` | `{ id }`                                  | `null`                                       |

Items returned by `get_items`/`get_item` carry the five fields. `check_url` (or whatever offline Add links uses to detect duplicates) and the offline save refuse a link already in another group of the project with the same message. After `update_item_research` and `merge_items` the item's file on disk is rewritten.

## Desktop client (`apps/desktop/src/lib/api.ts`)

Written by the orchestrator; use these, don't add others:

```ts
getProjectItems(projectId: string): Promise<Item[]>
updateItemResearch(id: string, patch: ItemResearchPatch): Promise<Item>
mergeItems(keepId: string, ids: string[]): Promise<MergeResult>
getCards(scope: { projectId: string } | { itemId: string }): Promise<Card[]>
putCard(card: CardInput): Promise<Card>
updateCard(id: string, patch: CardPatch): Promise<Card>
deleteCard(id: string): Promise<void>
getOutlineSections(projectId: string): Promise<OutlineSection[]>
putOutlineSection(section: OutlineSectionInput): Promise<OutlineSection>
deleteOutlineSection(id: string): Promise<void>
```

`Item` in `apps/desktop/src/lib/types.ts` has the five fields (optional, since old rows lack them), and `CheckUrlResult` has `elsewhere`.

## Desktop UI

All new UI follows `docs/dev/DESIGN.md` (tokens only; Newsreader for titles; rows not cards; `EmptyState`; `Kbd` hints; sentence case). Status colours: Keep `--success`, Maybe `--warning`, Cut `--muted-foreground` with the row's title dimmed; always an icon or word as well as colour.

### Sources and the reader (package C)

- **Source rows:** a status mark (small icon + tooltip; nothing when unset), up to two tag chips then `+N`, and the author type after the author in the muted line ("Epoch AI, Lab"; a guess reads "Lab (guess)"). Cut sources stay in the list, dimmed.
- **Group toolbar filter:** All / Keep / Maybe / Cut / No status, and a tag menu (the group's tags). Remember the choice per group for the session.
- **List keys** (when `list`): `1` Keep, `2` Maybe, `3` Cut, `0` clear status (on the focused row, or every ticked row in select mode), `t` tags editor, `u` summary editor. Select mode's floating bar gets **Status** and **Tag** menus.
- **Reader:** a compact source panel under the title: status buttons (Keep / Maybe / Cut), tags (chips + add field with suggestions: section titles first, then project tags), author (editable, placeholder the captured byline) and author type (menu; shows the guess), and the summary (a quiet box; click or `u` to edit, `Ctrl+Enter` saves, Esc cancels). The same keys `1` `2` `3` `0` `t` `u` work in the reader.
- **Cards from highlights:** the highlight menu gets **Make card** (`q`): creates a `quote` card from the current highlight (quote, seconds, item, highlight id, project, `position` after the pile's last) and a toast "Card added" with **Undo**. On a YouTube transcript it also gets **B-roll** (`b`): a `broll` card with the highlight's text as `quote`, its `seconds`, and `end_seconds` = the start of the next transcript paragraph when there is one. The highlights panel marks highlights that have a card (a small card icon); `getCards({ itemId })` feeds it.

### Project views (package D)

A project has three views besides its groups: **Outline**, **B-roll** and **Duplicates**. Add them as rows at the top of the sidebar's group area (icon, name, count: cards in the outline, clips, duplicate sets), and to the command palette. Keys (global): `g o` Outline, `g b` B-roll, `g d` Duplicates. Opening a group leaves the view. The top bar's breadcrumb shows `<Project> / Outline`.

- **Outline** has two modes, **Cards** and **Script** (tabs; `Shift+S` switches).
  - **Cards:** left, the **card pile** (unplaced cards, newest last; a filter by source and a text filter); right, the sections in order. **New section** (`n`), rename (double-click or `r`), delete (with confirm: "Its cards go back to the pile"), drag sections to reorder. Each section header shows "N sources tagged" (sources in the project with that tag; clicking it lists them). Cards drag from the pile into sections, within a section and between sections (positions from `positionBetween`); keyboard: `j`/`k` move focus, `Alt+↑/↓` move a card, `m` moves it to a section (menu), `Delete` deletes (Undo toast). A card shows the quote (3 lines, then "…"), the source title and time ("Engineering Explained, 3:12"), and the note. Enter opens the reader at the card's highlight (or its source).
  - **Script:** reads like a document. Section titles in Newsreader; each placed card is a line: its `script_line`, or the quote in quotation marks shown muted as a placeholder until edited. Click a line to edit it (textarea that grows; Enter saves, Esc cancels, empty restores the quote). After each line, its citation chip (`[2, 3:12]`); clicking it opens a small popover with the card (quote, source, time link, note) and **Open in reader**. Between lines, a hover **+** adds a `line` card there. B-roll cards read "B-roll: …" in italics. The header has **Copy script** (the `buildScript` Markdown) and **Copy references** with a menu: "Cited in the script" (`references` from `buildScript`) or "All Keep sources in the project" (`buildReferenceList` of the project's `keep` sources, by title). Copy shows "Copied".
- **B-roll:** every `broll` card in `orderBrollClips` order. Each row: the YouTube thumbnail (`youtubeThumbnailUrl`, lazy, 96×54, radius 6; a film icon tile when there's none), what it shows (`script_line` or `quote`, editable), source title, start and end (editable fields that take `parseClipTime` input; invalid input shows the field in `--destructive` and isn't saved), note, and actions: **Open at time** (the system browser, `cardLink`), **Place in outline** (section menu), Delete. **Add clip**: pick a YouTube source of the project (or paste any video link with a time), start, end, description. **Copy list** copies `buildBrollList`.
- **Duplicates:** `findDuplicateSets(getProjectItems(project))`. Each set is a block headed by its reason ("Same link"); each copy is a row with its tile, title, group path, saved date and highlight count. **Keep this one** opens a confirm dialog ("Keep this copy in <group>? The other copies are deleted. Their highlights, cards, tags and notes move to this one.") then calls `mergeItems`. **Open** opens the reader. Empty state: "No duplicates in this project."

## MCP (package E)

New tools in `apps/mcp/src/tools/research.ts` (and tests), following `define.ts` and the `project` guard pattern of the changing tools. Every changing tool takes the optional `project` (name or id) and refuses anything outside it.

| Tool               | Input                                                                                                                                                                                                                                                                                                                              | Does                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `set_source_info`  | `source_ids: string[]` (1–50), optional `status` (`keep`/`maybe`/`cut`/`none`), `add_tags`, `remove_tags`, `summary`, `author`, `author_type`, `project`                                                                                                                                                                           | Patches each source; a summary or author on several sources at once is refused. Replies with each source's new status and tags. |
| `list_tags`        | `project`                                                                                                                                                                                                                                                                                                                          | Outline sections first (marked), then other tags, each with its source count                                                    |
| `find_duplicates`  | `project`                                                                                                                                                                                                                                                                                                                          | `findDuplicateSets` over the project, each set with reason, ids, titles, group paths, dates                                     |
| `merge_duplicates` | `keep_id`, `ids`, `project`                                                                                                                                                                                                                                                                                                        | `POST /api/items/<keep>/merge`                                                                                                  |
| `make_card`        | `highlight_id` or (`source_id` + `quote`, optional `seconds`), optional `note`, `section`, `project`                                                                                                                                                                                                                               | Creates a `quote` card (the quote must appear in the source's reader text, like `add_highlight`; it doesn't create a highlight) |
| `add_broll`        | `source_id` or `url`, `start` (`m:ss` or seconds), optional `end`, `description`, `note`, `section`, `project`                                                                                                                                                                                                                     | Creates a `broll` card                                                                                                          |
| `list_cards`       | `project`, optional `section`, `kind`, `unplaced_only`                                                                                                                                                                                                                                                                             | Cards grouped by section, compact lines with ids                                                                                |
| `edit_outline`     | `project`, `actions[]`: `add_section {title, after?}`, `rename_section {section, title}`, `delete_section {section}`, `move_section {section, after?}`, `place_card {card_id, section, after_card_id?}`, `unplace_card {card_id}`, `set_line {card_id, text}`, `add_line {section, text, after_card_id?}`, `delete_card {card_id}` | Applies the actions in order; stops at the first that fails and says which ones ran                                             |
| `get_script`       | `project`, optional `format` (`script`/`references`/`keep_references`/`broll`)                                                                                                                                                                                                                                                     | The `buildScript` Markdown, its references, the Keep sources' reference list, or `buildBrollList`                               |

`list_sources` gains `status` and `tag` filters and shows status, tags and author type on each line; `read_source`'s overview header shows status, tags, author, author type and the summary. `add_links` gains `allow_duplicates` (default false) and reports cross-group duplicates as duplicates naming the group (the 409 message). Update `apps/mcp/manifest.json` descriptions through the build (it lists tools itself) and `docs/dev/handoff-mcp.md`'s tool table.

## Ownership

| Files                                                                                                                                                                                                                                                                          | Owner                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `packages/core/src/research.ts` + test, `packages/core/src/index.ts`, this file, `apps/desktop/src/lib/api.ts`, `apps/desktop/src/lib/types.ts`, `apps/desktop/src/features/shortcuts/registry.ts`                                                                             | orchestrator              |
| `supabase/migrations/20261019000000_research_tools.sql`, `apps/web/**`, `packages/core/src/drive-file.ts` (+ test), `packages/core/src/reader/*` (trailing-section parsing only), `packages/core/test/golden/item-with-research.*` and `golden.test.ts`, `docs/FILE-FORMAT.md` | A (backend)               |
| `apps/desktop/src-tauri/**` (db, models, service, commands, `main.rs`/`lib.rs` registration, Rust golden test)                                                                                                                                                                 | B (Rust)                  |
| `apps/desktop/src/features/items/**`, `features/reader/**`, `features/highlights/**`, new `features/research/source-info/**`                                                                                                                                                   | C (sources and reader UI) |
| new `apps/desktop/src/features/research/{outline,script,broll,duplicates}/**`, `App.tsx`, `features/shell/**`, `features/command-palette/**`, `features/folders/FolderTree.tsx` (only to host the view rows)                                                                   | D (project views UI)      |
| `apps/mcp/**`, `docs/dev/handoff-mcp.md`                                                                                                                                                                                                                                       | E (MCP)                   |

Anyone needing a change in a file they don't own reports it instead of editing it. `apps/desktop/src/lib/__tests__/ipc-contract.test.ts` must keep passing: B registers every command above; C and D only call `api.ts`.

## Checks

Each package runs its own tests plus `npm run typecheck` (or the workspace's), `npx prettier --check` on its files, and (B) `cargo test` in `apps/desktop/src-tauri`. Diff your work against `HEAD` before reporting: no removed functions or tests you weren't asked to remove.
