# Sourcefold

A personal research source collector. Save Grokipedia articles, Substack posts and X posts into folders, keep each one as clean Markdown, and push everything to Google Drive with one button so it can go straight into NotebookLM, Gemini or any other tool.

- **Chrome extension:** save the page you are on into any folder in one click.
- **Bulk add:** paste 30-40 Grokipedia links at once.
- **Markdown first:** every source is a `.md` file with a small header (source link, author, dates).
- **Read at the source:** clicking an item opens the original page.
- **Google Drive:** one Save button mirrors your folders and files into Drive.

> **Status:** planning. See [docs/SPEC.md](docs/SPEC.md) for the full spec and build plan.

## Stack

- Web app: Next.js (TypeScript) on Vercel
- Database, login and file storage: Supabase (Postgres, Auth with Google, Storage)
- Browser extension: Chrome (Manifest V3), built with WXT
- Storage mirror: Google Drive API (`drive.file` scope only)

## License

[MIT](LICENSE)
