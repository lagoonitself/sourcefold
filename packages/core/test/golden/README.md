# Golden Test Fixtures

These fixtures serve as the canonical test suite for the Markdown file format contract defined in `docs/FILE-FORMAT.md`. They are shared across implementations (TypeScript web app and desktop Rust agent).

## Schema (`<name>.input.json`)

Each input JSON file defines an item to be built into a canonical Markdown file:

```json
{
  "kind": "grokipedia | substack | wikipedia | x | note | youtube | web | reddit | pdf | hackernews | bluesky",
  "title": "Item title",
  "url": "https://example.com/canonical-url",
  "folder": "Folder/Subfolder",
  "saved": "YYYY-MM-DD",
  "created": "YYYY-MM-DD",
  "meta": {
    "summary": "...",
    "fact_checked": "YYYY-MM-DD",
    "language": "en",
    "revision": "1376335656",
    "last_edited": "YYYY-MM-DD or ISO 8601",
    "subtitle": "...",
    "author": "...",
    "author_url": "...",
    "publication": "...",
    "publication_url": "...",
    "published": "YYYY-MM-DD",
    "access": "free | paid",
    "post_url": "...",
    "posted": "YYYY-MM-DD"
  },
  "body": "Markdown body text",
  "note": "Optional user note"
}
```

### Fields

- `kind` (string, required): One of `"grokipedia"`, `"substack"`, `"wikipedia"`, `"x"`, `"note"`.
- `title` (string, required): Title of the item.
- `url` (string, optional): The item's canonical URL. Omitted or null for `note`.
- `folder` (string, optional): Relative folder path inside Drive/storage (e.g. `"Tech/AI"`).
- `saved` (string, optional): Date the item was saved in `YYYY-MM-DD` format.
- `created` (string, optional): Date the item was created in `YYYY-MM-DD` format (used for `note`).
- `meta` (object, optional): Kind-specific metadata dictionary.
- `body` (string, required): Main Markdown body content.
- `note` (string, optional): User note content (omitted or null if none).

## Files

- `grokipedia.input.json` & `grokipedia.md`
- `substack.input.json` & `substack.md`
- `substack-minimal.input.json` & `substack-minimal.md`
- `wikipedia.input.json` & `wikipedia.md`
- `wikipedia-minimal.input.json` & `wikipedia-minimal.md` (a revision given as a number; `language: "no"` and a title with a colon are quoted)
- `x-thread.input.json` & `x-thread.md`
- `note.input.json` & `note.md`
- `item-with-note.input.json` & `item-with-note.md`
- `youtube.input.json` & `youtube.md` (a duration like `1:02:10` is quoted so YAML 1.1 readers don't take it for a number)
- `web.input.json` & `web.md`, `web-minimal.input.json` & `web-minimal.md` (no site name: the host without `www.`; the meaningful query stays in the URL)
- `reddit.input.json` & `reddit.md`
- `pdf-arxiv.input.json` & `pdf-arxiv.md`, `pdf.input.json` & `pdf.md`
- `hackernews.input.json` & `hackernews.md` (a title with a colon is quoted)
- `bluesky.input.json` & `bluesky.md`
- `item-with-highlights.input.json` & `item-with-highlights.md` (a YouTube item with a `highlights` array of full snake_case `Highlight` objects, deliberately out of order: a text highlight with a timestamp and a note, an image, and a text highlight with two citations (one URL needs `<>`), a timestamp over an hour and a note, then the user note. Pins body, then `## My highlights`, then `## My note`.)
- `item-with-research.input.json` & `item-with-research.md` (a web page with the research fields `author`, `author_type`, `triage`, `tags` and `summary` next to the usual ones: `written_by`, `author_type`, `status` and `tags` go after `folder` in the front matter, and `## My summary` (the summary trimmed, line breaks kept) comes after the body, before `## My highlights` and `## My note`.)

The 2026-10 kinds (`youtube`, `web`, `reddit`, `pdf`, `hackernews`, `bluesky`) take their kind fields from `meta`, in the order given in `docs/FILE-FORMAT.md`. Numbers (`score`, `comments`, `points`, `pages`) are written unquoted.
