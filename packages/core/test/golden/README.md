# Golden Test Fixtures

These fixtures serve as the canonical test suite for the Markdown file format contract defined in `docs/FILE-FORMAT.md`. They are shared across implementations (TypeScript web app and desktop Rust agent).

## Schema (`<name>.input.json`)

Each input JSON file defines an item to be built into a canonical Markdown file:

```json
{
  "kind": "grokipedia | substack | x | note",
  "title": "Item title",
  "url": "https://example.com/canonical-url",
  "folder": "Folder/Subfolder",
  "saved": "YYYY-MM-DD",
  "created": "YYYY-MM-DD",
  "meta": {
    "summary": "...",
    "fact_checked": "YYYY-MM-DD",
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

- `kind` (string, required): One of `"grokipedia"`, `"substack"`, `"x"`, `"note"`.
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
- `x-thread.input.json` & `x-thread.md`
- `note.input.json` & `note.md`
- `item-with-note.input.json` & `item-with-note.md`
