# Changelog

Each release's downloads are on the [releases page](https://github.com/lagoonitself/sourcefold/releases). The release workflow copies the section for the tagged version into the release notes, so every version needs a section here before it's tagged.

## Unreleased

### Fixed

- Saving a Grokipedia article from the extension said "Something went wrong. Try again." when the extension was signed in by itself. The extension's background couldn't turn the article into Markdown because it has no page to parse the HTML with.

## 0.4.1 (2026-10-23)

### New

- **The extension signs in by itself.** Click **Sign in with Google** in the popup (or in Options) and the extension saves to your account and Google Drive without the website or the desktop app. With the desktop app open and signed in, it uses the app's sign-in instead, so signing in is optional. The website address and access token are gone from Options.

### Fixed

- The extension works with the 0.4.0 desktop app again. It said "Can't read the desktop app's sign-in" because the app now shares its sign-in in a new form.
- Paid Substack posts you subscribe to are saved in full, not as "Paid post, not saved", on pages that show a subscribe or paywall box outside the post (such as the substack.com reader).

## 0.4.0 (2026-10-23)

### New

- **The desktop app signs in by itself.** Click **Sign in with Google** on the welcome screen; the app no longer goes through the website, and does everything (adding links, Drive, the local copy, project files) on its own. You sign in once more after updating.

- **Project files.** Open the project menu and choose **Download project file** to save a whole project as one `.sourcefold` file: its groups, every source with its text and images, X threads, notes, highlights, tags, keep/maybe/cut, summaries, quote cards, the outline and b-roll. Send it to someone, and **Import project file** gives them their own copy as a new project. It works on the website and in the desktop app, signed in or offline, with a progress bar and a Cancel button (cancelling leaves nothing half-done). Post images and GIFs come from the file, so they don't have to be downloaded from the web again.

- **Photos and GIFs in saved X posts.** Saving an X post or thread from the extension now keeps each post's pictures at full size and its GIFs, in a `<Title>_files` folder next to the post in Drive and on your computer, with the pictures in the Google Doc and in the desktop reader (GIFs play there). Videos aren't downloaded; the post links to them with their length.

- **Sourcefold in Claude Desktop.** Add it from the desktop app (**Settings → Claude → Add to Claude Desktop**) or with `Sourcefold-Claude.mcpb`, then ask Claude to do what you do: browse your projects and groups and read your sources (long ones by section), add links, YouTube playlists and channels or a Substack publication to a group, rename, move, archive and delete, highlight passages, remove text you don't want, write notes, and save to Drive. It uses the desktop app's sign-in; with the app open, Claude can also search inside your sources and open things in the app for you.

- **Remove text you don't want from a saved source.** In the desktop reader, press `e` (or the eraser button), then select text and press **Remove**, or use the trash button beside a paragraph, a heading, a list item or an image. It works on articles, transcripts, threads and PDFs. **Edit as text** opens the saved Markdown for finer cuts. The change goes to Drive, the Google Doc and the local copy; highlights inside removed text go with it, and **Undo** puts everything back. Claude can do it too: ask it to cut a passage or a whole section, and to put it back.

### Fixed

- Links to a subreddit, Hacker News's front page, a Bluesky profile or YouTube's home page now say that only single posts and videos can be saved, instead of "Couldn't find the article text".
- A page with no text is no longer saved as an empty source. Such a source used to fail to save to Drive with a wrong "Drive held the only copy" message.

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
