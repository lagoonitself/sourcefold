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
| Substack   | `source`, `title`, `subtitle`, `url`, `author`, `author_url`, `publication`, `publication_url`, `published`, `access`, `saved`, `folder` |
| X          | `source`, `title`, `url`, `author`, `author_url`, `posted`, `saved`, `folder`                                                            |
| Note       | `source`, `title`, `created`, `folder`                                                                                                   |

`folder` is the full path with real names joined by `/`, for example `Cars/Engines/Diesel`.

### Source line

One blockquote line under the title, so a reader (or NotebookLM) knows where the text came from:

- Grokipedia: `> Saved from [Grokipedia](<url>) on <saved>. Grokipedia articles change; check the live page for edits.`
- Substack: `> Saved from [<publication>](<url>) on <saved>.` then, on the same line, ` By <author>.` if known and ` Published <published>.` if known. If there's no publication name, use `Substack`.
- X: `> Saved from [X](<url>) on <saved>.`
- Note: no source line.

Substack only: if there is a subtitle, it goes on its own line between the title and the source line, in italics: `*<subtitle>*`.

### Body

- Clean CommonMark plus GFM tables and footnotes. No raw HTML, scripts, buttons, share widgets, subscribe boxes or "like/comment" chrome.
- Headings inside the body start at `##`. The body never repeats the `# Title`.
- One blank line between blocks; never two or more in a row.
- Grokipedia citations are GFM footnotes `[^n]`. A run of markers lists each number once, in first-seen order: `[^76][^77][^76]` becomes `[^76][^77]`.
- Grokipedia references go under `## References`, one per line:
  `[^n]: [<title>](<url>) - <domain>`. If the title is empty or is just the URL, write `[^n]: <<url>> - <domain>`.
- X threads: one block per post, nested blockquotes for replies, each post starting with `**<name>** (@<handle>) · <date> · [link](<post url>)`. This is the existing `renderXThreadMarkdown` output in `packages/core/src/x/markdown.ts`.

## Shared tests

`packages/core/test/golden/` holds the expected file for each source type, built from fixed inputs (`*.input.json` next to each `*.md`). The TypeScript builders (`apps/web/src/features/drive/build-file.ts` and the `packages/core` builders) and the desktop Rust builders (`apps/desktop/src-tauri/src/service.rs`) both have a test that builds the file from the same input and compares it byte for byte. The HTML-to-Markdown step is not part of these tests (the two apps use different converters); the inputs give the body already converted.
