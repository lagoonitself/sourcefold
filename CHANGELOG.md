# Changelog

Each release's downloads are on the [releases page](https://github.com/lagoonitself/sourcefold/releases). The release workflow copies the section for the tagged version into the release notes, so every version needs a section here before it's tagged.

## 0.3.0 (2026-10-18)

### New

- **Highlights in the desktop reader.** Select text to highlight it, add a note, and copy the quote with its source. `Shift+H` opens a side panel with every highlight in the source; each group gets a **Highlights** tab that lists them all and copies them with a numbered source list. Highlights are written into the source's Markdown file as a `## My highlights` section, so Obsidian and your AI tools see them too.
- **Cited sources.** On a Grokipedia or Wikipedia article, see every reference it cites, which ones you already saved, and save the rest into the group in one go.
- **Search inside sources** in the desktop app, not just titles: press `/`, use `"exact phrases"` and `-word`, and `Tab` to search every project. Results open the reader at the matching paragraph, and `Ctrl+F` finds within a source.
- **Search by meaning** (optional, Settings → Search): finds passages that say the same thing in other words. It runs on your computer, using the GPU when it can.
- **A faster extension popup.** It opens at once on the project you used last and remembers your group, saves with `Enter`, and tells you before you press anything when a page can't be saved.
- **Simpler downloads:** one file each for Windows, Mac and the extension, with the same name in every release.

### Fixed

- YouTube transcripts are saved in English. Videos with YouTube's AI dubbing were sometimes saved in Arabic, Bangla or Dutch.
- Pasting many YouTube links no longer gets blocked: videos save a few seconds apart, and if YouTube pushes back the row pauses with a countdown and carries on by itself.

## 0.2.0 (2026-10-16)

### New

- **Desktop app for Windows and Mac**, keyboard first. Sign in to share a library with the website, or use it offline with everything stored on your computer.
- **Reader** in the desktop app: sources open as clean text with images in place and footnotes that jump to their references.
- **More sources:** YouTube transcripts (with playlists and whole channels in the desktop app), Wikipedia, Reddit, Hacker News, Bluesky, PDFs and arXiv, and almost any article or blog post.
- **Substack in the desktop app:** whole publications between two dates, paid posts you subscribe to, and each post's images.
- **Projects and groups:** one project per piece of work, groups inside groups, and archiving for finished projects. A link can sit in several groups.
- **Files you can use anywhere:** one tidy Markdown layout in Drive and on disk, a Google Doc copy of each source in Drive, and a local copy with Word files in `Documents/Sourcefold`.
- **Sharing:** the owner of a Sourcefold website can let friends sign in; each person only sees their own library.
- Select sources to move them or copy their links, and add images and notes from the desktop app.

### Changed

- Article text and images live in your Google Drive instead of the database, so a free database holds thousands of sources.

## 0.1.0 (2026-10-14)

First public release.

- **Website:** nested folders with drag and drop, **Add links** for Grokipedia, notes, image uploads, title search, and **Save to Drive** (`Ctrl+S`).
- **Chrome extension:** save the page you're on (Grokipedia, Substack, X) into any folder, right-click a Grokipedia link to save it, add X posts to an existing thread, and **Move here** for pages already saved elsewhere.
- Google Drive copy using only the `drive.file` permission.
