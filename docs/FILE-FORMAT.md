# Files on disk and in Drive

This is the contract for every file Sourcefold writes, in Google Drive (web app) and on disk (desktop app, offline mode). Both apps must produce the same layout and the same Markdown. If you change a rule here, change both apps and the shared tests.

## Folder layout

```
Sourcefold/
  Cars/                                   project, real name
    Engines/                              group, real name
      Impact of AI on the Future.md
      Why Decentralized AI Matters.md
      Thread by Jack Dorsey (@jack).md
      Turbo diagram.png
      Why Decentralized AI Matters_files/  images of that post (see "Post images")
    Engines/Diesel/                       groups nest to any depth
  Unsorted/                               desktop only: items with no group
```

- Folders use the project or group name as typed, not a slug. Only characters that a file system rejects are changed (see "Names" below).
- Each item is one file inside its group's folder. Nothing is written loose in `Sourcefold/`.
- Renaming, moving or deleting an item or group renames, moves or deletes its file or folder. Nothing is left behind.

## Names

The same rule applies to file names (without the extension) and folder names:

1. Start from the title or folder name.
2. Replace `:` with ` -`, and replace `/ \ | ` with `-`.
3. Remove `< > " ? *` and control characters.
4. Collapse runs of whitespace to one space; trim spaces and dots from both ends.
5. Cut to 100 characters at the last word break and trim again.
6. Empty result: `Untitled`. A Windows reserved name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, any case): append ` (file)`.
7. Two items in one folder with the same name (compared case-insensitively): the older one keeps the plain name, later ones get ` (2)`, ` (3)` in creation order. No random IDs in names.

Images keep their own extension; everything else is `.md`.

## Markdown

Every `.md` file is UTF-8 with `\n` line endings, ends with one newline, and has this shape:

```markdown
---
<front matter>
---

# <Title>

<source line>

<body>

## My note

<the user's note, only if there is one>
```

### Front matter

YAML, one field per line, in the order listed. Fields with no value are left out. Dates are `YYYY-MM-DD`. Strings are quoted only when YAML needs it.

| Source     | Fields, in order                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Grokipedia | `source`, `title`, `url`, `summary`, `fact_checked`, `saved`, `folder`                                                                   |
| Wikipedia  | `source`, `title`, `url`, `summary`, `language`, `revision`, `last_edited`, `saved`, `folder`                                            |
| Substack   | `source`, `title`, `subtitle`, `url`, `author`, `author_url`, `publication`, `publication_url`, `published`, `access`, `saved`, `folder` |
| X          | `source`, `title`, `url`, `author`, `author_url`, `posted`, `saved`, `folder`                                                            |
| Note       | `source`, `title`, `created`, `folder`                                                                                                   |

`folder` is the full path with real names joined by `/`, for example `Cars/Engines/Diesel`.

### Source line

One blockquote line under the title, so a reader (or NotebookLM) knows where the text came from:

- Grokipedia: `> Saved from [Grokipedia](<url>) on <saved>. Grokipedia articles change; check the live page for edits.`
- Wikipedia: `> Saved from [Wikipedia](<url>) on <saved>. Wikipedia articles change; check the live page for edits.`
- Substack: `> Saved from [<publication>](<url>) on <saved>.` then, on the same line, ` By <author>.` if known and ` Published <published>.` if known. If there's no publication name, use `Substack`.
- X: `> Saved from [X](<url>) on <saved>.`
- Note: no source line.

Substack only: if there is a subtitle, it goes on its own line between the title and the source line, in italics: `*<subtitle>*`.

### Body

- Clean CommonMark plus GFM tables and footnotes. No raw HTML, scripts, buttons, share widgets, subscribe boxes or "like/comment" chrome.
- Substack images stay where they were in the post, as a Markdown image linking to the original upload (`substack-post-media.s3.amazonaws.com`, not a resized CDN copy), with the caption in italics as its own paragraph below: `![<alt>](<url>)` then `*<caption>*`. Galleries list each image, then the caption. The image files are also saved next to the post; see "Post images".
- Headings inside the body start at `##`. The body never repeats the `# Title`.
- One blank line between blocks; never two or more in a row.
- Grokipedia citations are GFM footnotes `[^n]`. A run of markers lists each number once, in first-seen order: `[^76][^77][^76]` becomes `[^76][^77]`.
- Grokipedia references go under `## References`, one per line:
  `[^n]: [<title>](<url>) - <domain>`. If the title is empty or is just the URL, write `[^n]: <<url>> - <domain>`.
- Wikipedia (see `packages/core/src/wikipedia/convert.ts`):
  - `url` is the canonical article address after redirects, `https://<language>.wikipedia.org/wiki/<Title>` (underscores for spaces, parentheses written `%28`/`%29`). `summary` is Wikipedia's short description. `language` is the edition code (`en`; a code YAML could misread, like Norwegian `no`, is quoted). `revision` is the revision id the text came from, a bare number. `last_edited` is that revision's date, `YYYY-MM-DD`.
  - Headings start at `##`. Hatnotes ("For other uses…"), maintenance banners, "citation needed" tags, navboxes, sidebars, coordinates, edit links, the contents box and hidden text are left out. Sections left empty (the original "References" once its list moves to the end) are removed; "See also" and "External links" stay as lists of links.
  - Links to other articles are absolute `https://<language>.wikipedia.org/wiki/<Title>` links. Red links and links to `File:` and `Category:` pages become plain text.
  - The infobox becomes a two-column table `| Field | Value |` placed right after the lead paragraph, with the infobox picture and its italic caption above the table. Rows need a label and a value; list items and line breaks inside a value are joined with `; `. The title row, section header rows and rows without a label are dropped, and so is the whole infobox if no row is usable.
  - Citations are GFM footnotes `[^n]` numbered by first use. A source cited again keeps its number, and a run of markers lists each number once (`[^1][^2][^1]` becomes `[^1][^2]`). Footnote text goes under `## References`, one per line: `[^n]: <reference text with its links>`.
  - Pictures and thumbnails stay where they were, as `![<alt>](<full-size address>)` with the caption in italics as its own paragraph below. The address is the original file on `upload.wikimedia.org`, not the resized thumbnail (files a browser can't show, like PDFs, keep their thumbnail). Pictures under 40px (flags, icons) are skipped. Galleries list each picture, then its caption. Pictures inside tables are left out, except that a flag or icon's alt text stays as text.
  - Formulas keep their LaTeX: `$…$` inline, `$$` on its own lines for display equations (`|` inside a table cell is written `\vert`). Superscripts and subscripts become Unicode where the characters exist (`CO₂`, `m²`).
  - A simple table (one header row, no merged cells, same number of cells in every row) becomes a GFM table; rows with nothing in them are dropped. Any other table keeps its text, one `- ` bullet per row with cells joined by `·`. A table that only lays out other tables is dissolved and the tables inside are converted.
  - Wikipedia's text is CC BY-SA 4.0. The `url` and the "Saved from" line are the attribution and must stay with the text.
- X threads: one block per post, nested blockquotes for replies, each post starting with `**<name>** (@<handle>) · <date> · [link](<post url>)`. This is the existing `renderXThreadMarkdown` output in `packages/core/src/x/markdown.ts`.

## Post images

A post with images (any `![…](https://…)` in its Markdown) gets a folder next to its file named `<file name without .md>_files`, like a browser's "Save page as". It holds one copy of each image:

- File name: the image's own name on the web (for Substack's CDN, the original inside the `/image/fetch/…/` address), made safe with the "Names" rules, with its extension (`jpg` when it has none we know). Clashes get ` (2)`, ` (3)`; an image with no usable name is `image-<n>`. Same code in both apps: `postImageFileNames` in `packages/core/src/post-images.ts` and `image_file_names` in `apps/desktop/src-tauri/src/local_copy.rs`, tested on the same cases.
- In Drive the Markdown keeps the web links (Drive doesn't show Markdown images anyway); the folder is the saved copy. On this computer (the desktop's local copy) each saved image's link points at its copy, `![](Title_files/name.png)`, so it shows without a connection in Obsidian, VS Code and other Markdown readers. An image that couldn't be downloaded keeps its web link.
- The folder follows its post when it's renamed or moved, and goes when the post is deleted or has no images left. Only image files are ever removed from it, and a group that happens to be called `<title>_files` is never treated as one.
- Offline mode doesn't save images yet; its files keep the web links.

## Google Docs and Word copies

The Markdown is what AI tools read and what the app rebuilds from. To read a source laid out like the original (text, then the picture where it was, then more text), every text file also gets a readable copy next to it:

- **Drive:** a native Google Doc in the same folder with the file's name minus `.md` (`Why AI Matters.md` → Google Doc `Why AI Matters`; `X (2).md` → `X (2)`, so same-titled posts stay apart). It applies to every item kind except images, including notes. Sourcefold converts the Markdown to HTML (`apps/web/src/features/drive/google-doc.ts`) and uploads it with conversion to a Google Doc, so Drive fetches each `<img src="https://…">` and embeds it. Layout: a `<h1>` title, the subtitle in italics, a small grey "Saved from" line, then the body; images are centered and capped at the 6.5 inch page width (scaled from the size in a Substack image's name when known), with the italic caption directly under; X replies are indented quotes; tables keep their borders; the `## My note` section stays at the end. Footnotes `[^n]` become superscript numbers 1, 2, 3 … in first-seen order with a "Notes" list at the end (Docs doesn't keep anchors reliably), and Grokipedia's `## References` heading gives way to it. Front matter is dropped, raw HTML and `javascript:`/`data:` links are never passed through.
- **When:** in the save batch right after the Markdown and the image folder, before the item counts as saved, so a failure is tried again. The Doc is found by name and type in the file's folder; a rename or move of the file renames or moves it, and its content is replaced from the current Markdown each time (edits made in the Doc itself are overwritten). Deleting the item trashes it. Folders and other files are never touched.
- **This computer:** the desktop's local copy also keeps a `.docx` next to each `.md` (same path, `.docx` instead of `.md`), exported from that Google Doc with Drive's `files.export`. `GET /api/mirror` lists it as a second entry with the key `<id>:docx` and `format: "docx"` (the Markdown entry has the key `<id>`); `GET /api/items/<id>/content?format=docx` returns it, or `404` with the error code `not_ready` until the item has been pushed to Drive. The desktop skips a `not_ready` file without reporting a failure and asks again on the next run. The Word copy is tracked on its own, so it is renamed, moved and deleted with its post.
- Offline mode has no Google Doc, so no `.docx`.

## Shared tests

`packages/core/test/golden/` holds the expected file for each source type, built from fixed inputs (`*.input.json` next to each `*.md`). The TypeScript builders (`apps/web/src/features/drive/build-file.ts` and the `packages/core` builders) and the desktop Rust builders (`apps/desktop/src-tauri/src/service.rs`) both have a test that builds the file from the same input and compares it byte for byte. The HTML-to-Markdown step is not part of these tests (the two apps use different converters); the inputs give the body already converted.
