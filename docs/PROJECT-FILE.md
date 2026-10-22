# Project files (`.sourcefold`)

A project file holds one whole project: its groups and subgroups, every source with its text and images, X threads, notes, highlights, tags, keep/maybe/cut, summaries, author types, quote cards, the outline, the script and b-roll. Send it to someone; they import it and get their own copy. Nothing stays connected.

- **Download:** project menu → **Download project file** saves `Cars.sourcefold`.
- **Import:** project switcher → **Import project file**. Sourcefold shows what's inside ("Cars: 6 groups, 212 sources, 1,034 highlights, 38 MB") before adding it as a new project. A name already in use becomes "Cars (2)".
- Works on the website, the desktop app signed in and the desktop app offline. A file made in one opens in the others.

## What's inside

A `.sourcefold` file is a zip:

```
sourcefold.json                                 the manifest (below)
Cars/Engines/Turbocharger.md                    each source's file, exactly as Drive has it
Cars/Engines/Turbocharger_files/turbo.png       images and GIFs (.mp4) of that post
Cars/Engines/Diesel/Diagram.png                 an uploaded image source
```

- The folders and files follow [FILE-FORMAT.md](FILE-FORMAT.md): real project and group names made safe, ` (2)` for clashes by age, front matter, the source line, `## My summary`, `## My highlights`, `## My note`. Unzip it and the Markdown reads fine in Obsidian or VS Code.
- `sourcefold.json` carries what the Markdown can't carry exactly. Its shape is `projectFileManifestSchema` in `packages/core/src/project-file/manifest.ts`; `packages/core/test/golden/project-file.manifest.json` is a full example that the TypeScript and Rust tests both read.

### Manifest

| Field              | What                                                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`           | Always `"sourcefold-project"`.                                                                                                                                                                                                                 |
| `version`          | `1`. A reader refuses a higher version with "made by a newer version of Sourcefold".                                                                                                                                                           |
| `exported_at`      | ISO date-time.                                                                                                                                                                                                                                 |
| `app`              | Who wrote it: `Sourcefold web`, `Sourcefold desktop`, `Sourcefold desktop (offline)`.                                                                                                                                                          |
| `project`          | `{ id, name, created_at }`.                                                                                                                                                                                                                    |
| `groups`           | `{ id, parent_id, name, position, created_at }`. `parent_id` is null for a group directly in the project.                                                                                                                                      |
| `sources`          | One per item: `id, group_id, kind, title, source_url, canonical_url, meta, note, position, created_at, updated_at, triage, tags, summary, author, author_type`, then `file` (its path in the zip, or null) and `media_folder` (its `_files` folder, or null). |
| `x_posts`          | X thread posts: `id, source_id, parent_id, post_url, canonical_url, author_name, handle, author_url, posted_at, text, media, position, created_at`.                                                                                             |
| `highlights`       | `id, source_id, kind, quote, prefix, suffix, start_offset, end_offset, image_src, note, seconds, cited, created_at`.                                                                                                                          |
| `outline_sections` | `id, title, position, created_at`.                                                                                                                                                                                                             |
| `cards`            | Quote cards, b-roll and script lines: `id, kind, source_id, highlight_id, quote, seconds, end_seconds, url, note, script_line, section_id, position, created_at`.                                                                               |

- Ids are the exporter's ids. Every reference (a group's parent, a source's group, a highlight's source, a card's source, highlight and section, an X post's parent) points at a row in the same file.
- Import gives every row a new id and rewires the references (`remapProjectIds`), so importing the same file twice gives two separate projects.
- Highlights land in the same place after import because the body is the same: the body is what `bodyFromDriveFile` (or the Rust equivalent) cuts out of the source's `.md`.
- Deleted sources and groups are left out. Archived groups are exported like any other.

## Reading a file someone sent

The file is untrusted. Before anything is saved, every reader checks (`readProjectFile` in TypeScript, the same rules in Rust):

- It is a zip with a `sourcefold.json`; the manifest matches the schema; every reference resolves; no id appears twice; groups don't loop.
- Every path is relative, uses `/`, has no empty, `.` or `..` parts, no drive letters, no control characters or `< > : " | ? *`.
- Only `.md`, `.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`, `.avif`, `.svg` and `.mp4` files. Anything else is refused.
- Limits: 2 GB file, 4 GB unpacked, 200 MB per file, 100 MB manifest, 200,000 files (`PROJECT_FILE_LIMITS`).
- Every `file` in the manifest is in the zip.
- Markdown goes through the same handling as any saved source; nothing in it runs.

## Over the web API

The website and the signed-in desktop app run the same code (`exportProjectViaApi`, `importProjectViaApi` in `packages/core/src/project-file/api.ts`); the zip is made and opened in the browser or the app, never on Vercel, which refuses request bodies over 4.5 MB.

| Route                                            | What                                                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/projects/{id}/export?table=…&from=…`   | One page (up to 500 rows) of `groups`, `sources`, `x_posts`, `highlights`, `outline_sections` or `cards`. `{ data: { project, rows, next } }`.               |
| `GET /api/items/{id}/content`                    | The source's file as Drive has it (already existed).                                                                                                       |
| `GET /api/items/{id}/media`                      | The files in the source's `_files` folder in Drive: `{ data: { files: [{ name, size, too_large }] } }`.                                                     |
| `GET /api/items/{id}/media/{name}`               | One of those files. Files over 4 MB are listed as `too_large` and left out of the project file; the Markdown still links to the web copy.                  |
| `POST /api/uploads/sign`                         | Signed upload for an image source; takes an optional `item_id` so the import keeps the id it chose.                                                        |
| `POST /api/projects/{id}/import`                 | `{id}` is the new project's id. First call `{ project: { name }, groups }` creates it; later calls add `groups`, `sources` (with `markdown` and `storage_path`), `x_posts`, `highlights`, `outline_sections`, `cards` in batches under 3.5 MB; the last call `{ done: true }` starts the Drive push. Answers `{ data: { name } }`. |

On the website, the images inside a post (`_files`) aren't uploaded on import: the Drive push copies them from the web again, as it does for any saved post. The offline desktop app writes them straight from the file.
