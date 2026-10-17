# Plan: reader, highlights and search

Status: planned 2026-10-17, nothing built yet. Desktop app first. No LLM.

## Why

Creators who research videos read sources, mark what matters, look facts up again, check them against other sources, and paste quotes into a script with a source list. Today that happens across Readwise Reader, screenshots, Obsidian or Notion search, a fact-check spreadsheet and NotebookLM. Sourcefold already collects the sources. This plan makes it the place where they are read, marked and found again, so the creator doesn't switch apps.

A feature only counts if it's quicker than the app it replaces. The rules below are the bar every step has to pass.

## UX rules

1. **Stay in the window.** Reading, marking, searching and copying all happen in Sourcefold. The only reason to leave is `o` (open the original).
2. **No extra steps to mark.** Selecting text makes a highlight. No dialog, no confirm. `z` undoes.
3. **The source comes along automatically.** Every highlight and every copied quote carries its title, site, date and link (and the timestamp for YouTube). Nobody types a citation.
4. **Search lands on the passage.** A search result opens the reader scrolled to the matching passage with the match marked, not at the top of a 200 KB article.
5. **Keyboard first, mouse equal.** Every action has a key, is listed in `?`, and also has a visible button.
6. **Instant.** Highlights are saved locally first and synced after. Keyword search answers while typing (under 100 ms for a few thousand sources).
7. **Quiet background work.** Indexing never blocks the window; it shows one progress line and can be paused.
8. **Same in both modes.** Signed in and offline behave the same way.

Patterns borrowed: Readwise Reader (select = highlight, paragraph focus with `j`/`k`, `h` to highlight, `n` to note, undo), Zotero 7 (annotations panel beside the text, quotes keep a citation and jump back to their place), Raycast / Linear (one search box, results grouped, keyboard only), W3C Web Annotation (anchor a highlight by its quote plus the text around it, so it survives re-saves).

## Phase 1: reader becomes the place to work

The reader exists (`apps/desktop/src/features/reader/`, full-window, opens with Enter). It gains highlights, a side panel and source-to-source movement.

### Highlights

- **Make one:** select text with the mouse, or move the paragraph focus with `j`/`k` and press `h`. The highlight appears at once in a soft green (`--accent`). Holding `Alt` while selecting selects without highlighting (for plain copying). A switch in the reader menu turns automatic highlighting off for people who prefer a button.
- **Images:** focus an image and press `h`, or click it and choose Highlight. Image highlights are what later becomes the B-roll list.
- **Small menu on a highlight** (appears on click or right after making it): Note (`n`), Copy with source (`c`), Delete (`Backspace`). No other buttons.
- **YouTube:** a highlight in a transcript keeps the timestamp of its line. Clicking the timestamp opens the video at that second.
- **Grokipedia and Wikipedia:** a highlight keeps the references cited inside it (`[^12]` footnotes). The menu shows them as small chips ("nature.com", "reuters.com"); each opens the reference or saves it as a source in the same group. This turns "Grokipedia says X" into "X, cited to these sources".
- **Undo:** `z` or `Mod+Z` undoes the last highlight, note or delete.

### Side panel

- `Shift+H` or the panel button toggles a 320 px panel on the right of the reader with two tabs: **Highlights** (in reading order; click one to scroll to it) and **Cited sources** (Grokipedia and Wikipedia only, see below).
- Reading width stays the same when the panel opens. The panel is closed by default and remembers its state.

### Cited sources (Grokipedia, Wikipedia)

- Lists every reference in the article with its title and domain. References already saved in this project show "Saved in <group>".
- Tick references and press **Save to group**: they go through the existing Add links queue (same statuses, same Stop and Retry). This makes a Grokipedia article a starting point for finding sources, as the owner uses it.

### Moving between sources

- `]` and `[` open the next and previous source in the group without closing the reader. The title bar shows "3 of 24".

### Highlights view for a group

- The group header gets two tabs: **Sources** and **Highlights (24)**.
- Highlights view: one row per highlight, with the quote in the serif face, the source title with its type bar, the note, and the timestamp or reference chips. Enter opens the reader at that highlight.
- Select mode (`s`) and **Copy with sources**: copies the selected quotes as Markdown, each followed by its numbered source, with a source list at the end. This also serves as the first version of the "source list for the description".

Copy format, one quote:

```markdown
> The exhaust spins a turbine, and the turbine drives a compressor.

— How a Turbocharger Works, Engineering Explained, YouTube, at 0:47. https://youtu.be/abcDEF12345?t=47
```

### Data

- New table `highlights`: `id`, `user_id`, `item_id`, `kind` (`text` | `image`), `quote`, `prefix` and `suffix` (about 32 characters each side), `start` and `end` (offsets in the rendered body text), `image_src`, `note`, `seconds` (YouTube), `cited` (JSON list of `{ n, title, url }`), `created_at`, `updated_at`, `deleted_at`.
- Signed in: Supabase table with RLS, `GET/PUT/PATCH/DELETE /api/highlights` (token routes filter by `user_id`, see HANDOFF lessons). The desktop calls the web API directly, like every other signed-in change, and shows the highlight before the request finishes.
- Offline: the same table in `sourcefold.db`.
- Anchoring: find the highlight by `start`/`end` first; if the text there doesn't match `quote`, search for `prefix + quote + suffix`; if that fails, show the highlight in the panel as "Couldn't find this passage in the current text" and keep it.
- Highlights are small text, so they stay in Supabase like notes; they are not cleared after the Drive push.
- They are also written into the source's own `.md` file as a `## My highlights` section (Drive, local copy and offline files), so any Markdown app can read them. The exact build contract is `docs/handoff-highlights.md`.

### Done when

- Selecting text in a Grokipedia, YouTube and Substack source makes a highlight with no extra click, it survives closing and reopening the app, and syncs to a second signed-in desktop.
- `c` puts the quote with its source on the clipboard in the format above.
- A Grokipedia highlight shows the references inside it; **Save to group** from Cited sources saves them.
- A group's Highlights tab copies 10 quotes with a numbered source list in one action.
- Every new key is in the `?` sheet and in `registry.ts`; the IPC contract test passes.

## Phase 2: search inside every source (keywords)

### Experience

- The existing search (`/`) becomes the one search box. Results are grouped:
  - **Sources**: title matches (as today), top 3.
  - **Passages**: matches inside the text, each with the source title, group, and a two-line snippet with the matched words in bold.
  - **Highlights and notes**: matches in your own highlights and notes.
- Scope: "This project" by default; `Tab` switches to "All projects".
- Quotes for exact phrases (`"twin scroll"`), `-word` to exclude. No other syntax.
- Enter on a passage opens the reader at that passage with every match marked; `Mod+F` searches inside the open source, `Enter` / `Shift+Enter` move between matches. From there, `h` highlights.
- Bottom line of the search box: "Searching 1,240 sources", or "Indexing 812 of 1,240 sources" while it builds.
- Empty result copy: `No sources mention "<query>".`

### Technical

- SQLite FTS5 (included in the bundled `rusqlite` build) in the desktop's own database. Search runs on this computer only; the web app keeps title search.
- One shared chunker splits each source's body into **passages**: by heading and paragraph, 150–400 words, YouTube passages keep their first timestamp. Tables: `passages(id, item_id, ord, heading, start, end, seconds, hash)` and `passages_fts(text, heading)` with `bm25()` ranking and `snippet()` for snippets. Phase 3 reuses the same passages, so every result in every phase maps to a place in the reader.
- What gets indexed: offline mode reads the storage folder; signed in, it reads the local copy (`local_copy.rs`). If Local copy is off, search says "Turn on Local copy in Settings to search inside sources." and still searches titles.
- Indexing: on start, after each capture, and after each local copy pass; a content hash per item skips unchanged files. Runs on a background thread.
- Highlights and notes are indexed too.

### Done when

- A word that appears only deep inside a 200 KB Grokipedia article finds it, and Enter lands on that paragraph with the word marked.
- Typing gives results within 100 ms on the owner's library.
- Saving a new source makes it searchable within a few seconds without restarting.

## Phase 3: search by meaning, on this computer (EmbeddingGemma 2)

Keyword search misses passages that use other words ("turbo lag" vs "delay before boost builds"). EmbeddingGemma 2 finds those, runs locally on the GPU, and puts text and images in one space, so a text search can return pictures inside sources (charts, diagrams, photos), which helps when planning visuals. The original EmbeddingGemma is text only; version 2 adds images.

Facts checked 2026-10-17 (Google model page, Hugging Face ONNX card): open weights under Apache 2.0, 768-dimension vectors that can be cut to 512, 256 or 128, 8,192-token context, text model 175 MB and image model 109 MB at 4-bit (q4), task prompts such as `task: search result | query: …` for queries and `title: … | text: …` for documents, and `task: fact checking | query: …` for checking a claim.

### Experience

- Off by default. Settings → Search: "Search by meaning (runs on this computer)", the download size, whether it uses the GPU or the CPU, progress, **Pause**, and **Delete index**.
- The same search box, no mode switch. Keyword and meaning results are merged. A passage found only by meaning gets the small label "Similar meaning" and shows the passage start as its snippet.
- **Images** section: a row of thumbnails from images inside sources and image items; Enter opens the reader at that image.
- **Find in other sources** on any highlight (menu and key `f`): lists passages from other sources in the project that say something close, using the fact-checking prompt. This is the cross-checking step creators do by hand, without an LLM. Each result opens the reader at that passage.

### Technical

- **Spike first, before building:** run EmbeddingGemma 2 on the owner's PC both ways and measure.
  - A: Transformers.js in a Web Worker in the desktop webview, `device: "webgpu"`, falling back to WASM. The model card's own example covers text and images. WebView2 is Chromium, so WebGPU should be available on Windows; macOS needs a WebKit with WebGPU.
  - B: ONNX Runtime from Rust (`ort` crate) with DirectML on Windows and CoreML on macOS.
  - Pick by: works on the owner's GPU, passages per second, extra install size, and image support. Prefer A if it is fast enough, since it needs no native Rust libraries.
- Vectors: 256 dimensions (Matryoshka), stored per passage as a BLOB in SQLite. Brute-force cosine in Rust is fine up to about 200,000 passages (about 200 MB); add `sqlite-vec` only if that gets slow.
- Merge keyword and meaning results with Reciprocal Rank Fusion (k = 60), fetching about 4× the shown count from each.
- The model downloads from Hugging Face on opt-in into the app data folder; it is never in the installer.
- Indexing cost is the open question: a long Grokipedia article is about 100 passages. The spike must report how long 1,000 sources take on the owner's GPU. Indexing runs when the app is idle and can be paused.

### Done when

- "delay before boost builds" finds a passage about turbo lag that never uses those words.
- A search for "diagram of a turbocharger" shows an image from inside a saved article.
- **Find in other sources** on a highlight lists passages from at least two other sources that say the same thing, when they exist.
- Turning it off and deleting the index frees the disk space.

## Not in this plan

Script document, source-list builder for whole scripts, claim check board, asking questions of sources (no LLM for now), visuals list, phone app, Google export. These come after, built on highlights and passages.

## Owner's decisions (2026-10-17)

1. Highlights are kept in the database and written into the source's `.md` file as a `## My highlights` section, so they open in any Markdown app.
2. Selecting text highlights it by default; `Alt` selects without highlighting; a switch turns it off.
3. The web app stores and serves highlights but doesn't show them in phase 1.
