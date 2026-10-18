# Build contract: search inside sources, by keyword and by meaning

Status: contract written 2026-10-17, built 2026-10-18 (see "Built: deviations" at the end). Desktop app only; the web keeps title search. This replaces phases 2 and 3 of `docs/PLAN-reader-search.md` where they differ (it builds both at once and leaves images and **Find in other sources** for later).

## Owner's decisions (2026-10-17)

1. **One index per project, fully separate.** A project (one per video, in practice) has its own index file. Searching a project never opens another project's file, so nothing from another project can show up or influence ranking. Vectors are stored per project too; nothing is shared between projects, not even a cache.
2. **"All projects" search** asks every project's index and merges the answers. It is a separate scope, picked with `Tab` in the search box.
3. **Search by meaning runs on this computer, on the GPU:** EmbeddingGemma 2 (Google, open weights, Apache 2.0), `onnx-community/embeddinggemma-2-ONNX`, text model only, `q4` (175 MB), through Transformers.js 4.3 with WebGPU in a Web Worker, falling back to WASM (CPU). No API, no account; nothing leaves the computer except the one model download from Hugging Face.
4. Keyword search (SQLite FTS5) is always on. Meaning search is off until the owner turns it on in Settings → Search, which downloads the model.

## Model facts (Hugging Face card, checked 2026-10-17)

- Query: `task: search result | query: <query>`. Document: `title: <title> | text: <passage>` (`title: none` when there is no title).
- Native 768 dimensions; Matryoshka to 512/256/128. **We use 256**: slice the first 256 values, then L2-normalize again (required, or ranking silently degrades). Queries and passages must use the same size.
- Load text only: `AutoConfig.from_pretrained(id)`, set `config.vision_config = config.audio_config = null`, then `AutoModel.from_pretrained(id, { config, device: "webgpu", dtype: "q4" })` and `AutoTokenizer.from_pretrained(id)`; the output is `sentence_embedding` (already mean-pooled and normalized at 768).
- On WebGPU keep each batch under about 2,700 tokens in total, or kernels hit a GPU limit. Use batches of at most 2,000 tokens (count with the tokenizer) and cut any single input at 1,024 tokens.
- The model id plus dtype plus size make the **model key** `embeddinggemma-2/q4/256` (`EMBEDDING_MODEL_KEY` in `search-api.ts`). Rust stores the key with every vector and ignores vectors of another key.

## Where things live

- Index files: `<app data>/search/<project id>.sqlite` (`app data` is `crate::session::app_data_dir()`, the folder that holds `sourcefold.db`). Under `cfg(test)` a temp dir, never the real folder.
- The model: Transformers.js's browser cache (Cache Storage `transformers-cache` in the webview's data). **Delete model** in Settings clears it.
- Source text comes from files on disk: offline mode reads its storage folder (`items.storage_path` under `resolve_storage_dir`); signed in, the local copy (`local_copy_files` + `resolve_storage_dir`). With Local copy off, the index has nothing to read: status `needs_local_copy`, and the search box says "Turn on Local copy in Settings to search inside sources." while still searching titles.

## Catalog: which files belong to which project

- Offline: `items` (not deleted, status saved, not images) joined to `folders`; the project is the top-level ancestor (`parent_id` null). Items with no group (desktop "Unsorted") use project id `unsorted`.
- Signed in: the web app's `GET /api/mirror` entries now also carry `folder_id`, `project_id` and `title` (done in `apps/web/src/features/mirror/manifest.ts`; needs a deploy). `local_copy.rs` reads them (`#[serde(default)]`, so older web apps still parse), keeps them in `local_copy_files` (new nullable columns `project_id`, `folder_id`, `title`, `kind`, added with `ALTER TABLE` when missing), and only `format: "file"` entries count. If entries arrive without `project_id`, status is `needs_web_update` with the message "Update the web app to search inside sources." Images (`kind = image`) and `.docx` files are never indexed.
- Projects that vanish from the catalog get their index file deleted. Items that vanish get their rows deleted.

## Passages (one chunker, in Rust)

Input is the whole `.md` file (docs/FILE-FORMAT.md). The chunker:

1. Drops front matter, the `# Title` line and the `> Saved from …` source line.
2. Cuts off `## My note` (last occurrence) and then `## My highlights` (last occurrence). Each highlight block (`> quote` or `![alt](src)`, plus its optional details line) becomes one entry of type `highlight` (details line text included, so a highlight's note is searchable); the note becomes entries of type `note`. A whole `note` item's body is type `note`.
3. Splits the body by headings and blank-line paragraphs, then packs paragraphs into passages of 150–400 words (a passage ends at a heading; a paragraph over 400 words is split at sentence ends). The heading path above a passage is kept (`History › Early life`).
4. Strips Markdown so text reads as text: `[text](url)` → `text`, `![alt](src)` → `alt`, `[^12]` and `[12]`-style footnote marks removed, `**`/`*`/`_`/`` ` ``/`~~` removed, table pipes and divider rows removed, HTML tags removed, `$…$` kept without the dollars, YouTube `[m:ss](https://youtu.be/…)` timestamps removed from the text but the passage's first one kept as `seconds`.
5. `passage_start` = the passage's first 12 words of the stripped text.

The footnote/reference list at the end of Grokipedia and Wikipedia files (the `[^n]: …` definitions) is not indexed as passages.

## Index file schema (per project)

```sql
meta(key TEXT PRIMARY KEY, value TEXT)                  -- schema_version, project_id
sources(item_id TEXT PRIMARY KEY, folder_id TEXT, title TEXT, kind TEXT, url TEXT,
        path TEXT, fingerprint TEXT, content_hash TEXT, indexed_at TEXT)
passages(id INTEGER PRIMARY KEY, item_id TEXT, ord INTEGER, type TEXT,  -- body | highlight | note
         heading TEXT, text TEXT, passage_start TEXT, seconds REAL, text_hash TEXT)
passages_fts USING fts5(text, heading, content='passages', content_rowid='id',
                        tokenize='porter unicode61 remove_diacritics 2')
vectors(text_hash TEXT, model TEXT, vec BLOB, PRIMARY KEY (text_hash, model))  -- f32 little-endian
```

- `fingerprint` = file size + modified time; only a changed fingerprint makes the indexer read the file, and only a changed `content_hash` (FNV-1a 64 of the bytes, hand-written so it never changes between Rust versions) re-chunks it.
- `text_hash` = FNV-1a 64 (hex) of the embed input (`title: … | text: …`). Re-chunking a source keeps the vectors of passages whose text didn't change. Vectors whose hash no passage uses any more are deleted after each pass.
- `url` comes from the file's front matter `url:`; `title` from the catalog (fallback: front matter `title:`).

## Indexer (Rust, background thread)

- Started from `main.rs` `setup` (never in the native-host process). Wakes on `search_reindex_now`, after every local copy pass (`local_copy::sync` calls `search::notify()`), after offline writes made through `service` (capture, rename, move, delete, note and highlight changes call `search::notify()`), and every 30 s.
- Each pass: build the catalog, sync each project's file, update the status counters. Never two passes at once. Paused (`search_set_paused`) means passes are skipped until resumed; the pause is kept in `settings` (`search_paused`).
- Writes happen in one transaction per source, so a search during indexing sees either the old or the new passages of a source.

## Query (Rust)

- Syntax: words; `"exact phrase"`; `-word` excludes. Every token is quoted for FTS5 (no FTS5 syntax leaks from user input); the last bare word gets a prefix `*` while typing. Only negative terms → no keyword results.
- Per project: keyword top 40 by `bm25(passages_fts, 1.0, 0.5)` with `snippet(passages_fts, 0, char(2), char(3), '…', 24)`; if a query vector is given (and its model key matches), meaning top 40 by dot product over that project's vectors (in-memory cache per project, dropped when that project's vectors or passages change).
- Merge with Reciprocal Rank Fusion, k = 60, over the keyword list and the meaning list. `matched` is `keyword`, `meaning` or `both`. A meaning-only hit uses the passage's first ~30 words as its snippet (no marks). Drop meaning-only hits below a cosine of 0.35.
- "All projects": run the per-project step on every index file, then merge all keyword lists by bm25 and all meaning lists by cosine before the RRF.
- `passages` holds `type = body`, `notes` holds `highlight` and `note`. Default limit 30 passages, 10 notes. At most 3 passages per source in the list, so one long article can't fill it.
- Target: keyword answer under 100 ms on a few thousand sources.

## Embedding (webview)

- A Web Worker loads the model once (WebGPU, then WASM if WebGPU fails) and answers `embed(texts) → Float32Array[256][]` and `embedQuery(text)`. Query embeds jump ahead of background batches.
- A background loop runs while search by meaning is on and the app is open: `search_embed_jobs(model, 64, current project)` → embed in token-limited batches → `search_put_vectors`. It keeps going while the window is hidden, and yields after each batch so typing stays smooth. It stops when the queue is empty and checks again every 30 s or after `reindexNow`.
- Settings → Search shows: the switch "Search by meaning (runs on this computer)", "Downloads a 175 MB model from Hugging Face once.", download progress, "Using the GPU (WebGPU)" or "Using the CPU (WebGPU isn't available)", speed in passages per second while indexing, "N of M passages", **Pause**, **Delete index**, **Delete model**. The setting itself (`search_meaning`) is stored in the webview's `localStorage` under `sourcefold:searchMeaning`.

## Commands (Rust ↔ TypeScript)

The TypeScript side is `apps/desktop/src/features/search/search-api.ts` (written first, the source of truth for names and shapes). JS passes top-level args in camelCase; the Rust params are snake_case.

| Command                 | Rust params                                                                                                                                                                   | Returns          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `search_query`          | `request: SearchRequest` (`query`, `scope` "project"/"all", `project_id`, `query_vector: Option<Vec<f32>>`, `model: Option<String>`, `limit: Option<u32>`; snake_case fields) | `SearchResponse` |
| `search_status`         | `project_id: Option<String>`, `model: Option<String>`                                                                                                                         | `SearchStatus`   |
| `search_reindex_now`    | —                                                                                                                                                                             | `()`             |
| `search_set_paused`     | `paused: bool`                                                                                                                                                                | `()`             |
| `search_delete_index`   | —                                                                                                                                                                             | `()`             |
| `search_embed_jobs`     | `model: String`, `limit: u32`, `prefer_project_id: Option<String>`                                                                                                            | `Vec<EmbedJob>`  |
| `search_put_vectors`    | `model: String`, `vectors: Vec<EmbedVector>`                                                                                                                                  | `()`             |
| `search_delete_vectors` | —                                                                                                                                                                             | `()`             |

`search_put_vectors` rejects a vector whose length isn't 256 or that contains a non-finite value, and stores it only if a passage in that project still has that `text_hash`.

## Search box (`/`)

- One box, three sections in this order: **Sources** (title matches, the existing `searchItems`, top 3), **Passages**, **Highlights and notes**. Arrow keys move across all rows.
- Scope chip "This project" / "All projects"; `Tab` switches. In "All projects" each row also shows the project name.
- Passage row: source title (serif) with its type bar, group (and project), heading, two-line snippet with the marked words bold, the timestamp for YouTube, and the label "Similar meaning" when `matched` is `meaning`.
- Typing: keyword query after 120 ms; when meaning is on, the query is embedded at the same time and the search runs again with the vector, replacing the list without moving the selection off the same row if it's still there.
- Footer: "Searching N sources" or "Indexing N of M sources", plus "Search by meaning: N of M passages" while vectors are being made. Empty: `No sources mention "<query>".` With Local copy off, the message above.
- Enter on a passage or note opens the reader on that source at that place (any project; the app doesn't switch projects for an "All projects" hit outside the open one, it just opens the reader). Enter on a source row behaves as today.

## Reader

- New prop `initialSearch?: { query: string; passageStart: string } | null` on `ReaderModal`. Once the text renders, the reader finds `passageStart` in the rendered text (whitespace and case folded, punctuation ignored; tries 12 words, then 8, then 5; if none match, the first match of a query word), scrolls it to the upper third and flashes it, and marks every match of the query's words in the source (the find marks below).
- `Mod+F` opens a find bar inside the reader: marks every match, shows "3 of 17", `Enter` / `Shift+Enter` next and previous, `Esc` closes and clears the marks. Find marks are separate from highlight marks (own element and attribute) and never saved. Opening from search fills the bar with the query.
- `h` still highlights from the focused paragraph, so search → read → highlight needs no mouse.

## Shortcuts

`registry.ts`: `app.search` description becomes "Search titles and the text of every source". Add to `READER_COMMANDS`: `reader.find` (`Mod+F`, "Find in this source"), `reader.find-next` (`Enter`, while the find bar is open), `reader.find-previous` (`Shift+Enter`). Add the search box's `Tab` (switch "This project" / "All projects") to the `?` sheet.

## Done when

- A word that appears only deep inside a 200 KB Grokipedia article is found; Enter lands on that paragraph with the word marked.
- A search in project A never returns anything from project B; "All projects" returns both, labelled.
- Keyword results within 100 ms while typing; a newly saved source is searchable within seconds (offline) or right after the next local copy pass (signed in).
- With meaning on, "delay before boost builds" finds a passage about turbo lag that never uses those words, and the row says "Similar meaning".
- Settings shows the device (GPU or CPU) and the speed; **Delete index** and **Delete model** free the space.
- `npm run lint`, `npm run typecheck`, `npm test`, `cargo test` pass, and the IPC contract test covers every new command.

## Built: deviations (2026-10-18)

- The last bare word matches as `("w" OR "w"*)`, so a stemmed exact match and a prefix both count. Exclusions are `(a AND b) NOT (c OR d)` because of FTS5's `NOT` precedence.
- A meaning hit that is also a keyword hit is `both` even under cosine 0.35; only meaning-only hits below 0.35 are dropped.
- The 3-per-source cap applies to passages, not to highlights and notes.
- While the catalog is `needs_local_copy`, `needs_web_update` or waiting for the first local copy pass, existing index files are left alone (not deleted).
- `PassageHit` / `NoteHit` carry `project_id` only; the search box looks the project name up.
- The reader's find matches word forms ("engines" finds "engine").
- Transformers.js fetches its ONNX Runtime files from `cdn.jsdelivr.net` on first use (library default), so not only the model download leaves the computer yet. Fix: point `env.backends.onnx.wasm.wasmPaths` at the bundled files (ROADMAP).
