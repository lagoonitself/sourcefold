# Changelog

Each release's downloads are on the [releases page](https://github.com/lagoonitself/sourcefold/releases). The release workflow copies the section for the tagged version into the release notes, so every version needs a section here before it's tagged.

## 0.6.1 (2026-11-05)

### New

- **The Shelf: sites you visit often, with a note.** Keep a site without downloading it or bookmarking it in Chrome. **Shelf** is at the top of the sidebar (`Ctrl+Shift+L`). **Add to shelf** (`Ctrl+L`) takes a link with a title, a note and tags, or several links pasted one per line. Pin the ones you want first; the rest are ordered by how often you open them. Edit, copy, delete (with Undo), or **Save as a source** when you want the page itself. **Import bookmarks** reads the `bookmarks.html` Chrome, Edge or Firefox exports, with folders as tags. `Ctrl+K` lists your shelf too. Works signed in and offline.
- **Shelve in the extension.** A **Shelve** button next to Save keeps the current page on your shelf, with a note and tags. When you're on a shelved site that has a note, the extension's icon shows a dot. The extension updates by hand: reload it in `chrome://extensions`.

## 0.6.0 (2026-11-05)

### New

- **The desktop app updates itself.** It checks for a new version when it starts (and every few hours), and a message offers **Update and restart**: the new version downloads, installs and opens by itself. **Settings → General → Updates** shows your version and has **Check for updates**. This is the last version you install by hand. After an update, the app also offers to update Sourcefold in Claude Desktop: click **Update**, then **Install** in Claude's window.
- **A better reader.** Reading settings (font, size, width, spacing), the contents and footnotes in the margins, your place kept when you come back, and Focus.
- **Sourcefold in Claude on the web.** Add Sourcefold as a connector on claude.ai. Links Claude adds there that need your computer (YouTube, paid Substack posts) wait until the desktop app or the extension is open.

### Fixed

- Claude Desktop can use the desktop app's sign-in again, and Claude's status check says when that sign-in was refused or has expired. It now works straight from the desktop app's sign-in, with no website involved, so `list_projects`, `find_sources` and the rest no longer say "isn't signed in" while the app is signed in.
- **Security:** links to your own computer or local network (`localhost`, `192.168.x.x`, `10.x.x.x`, `169.254.169.254` and the like) are refused when Claude adds them, by the link queue, and by the desktop app and the extension before they open a waiting link, so they can never be opened from your computer or in Chrome.
- Claude's `add_links` accounts for every link it's given: a link given twice, text that isn't a link and `file:` links are listed as left out instead of vanishing, and a slow or hostile site can no longer fail the whole call.
- Notes keep exactly what you wrote: a first `# Heading`, later `# Headings` and the first line's indent are no longer changed.
- `set_source_info` changes nothing when one of the ids is wrong, and refuses `source_id` with `source_ids` or `tags` with `add_tags`/`remove_tags`.
- `move_sources` with `if_duplicate: "merge"` works.
- A group's position must be between 0 and 2,147,483,647, instead of failing with "Something went wrong".
- Substack date filters find older posts (the archive stops after a few weeks; the sitemap is used then), and an impossible date like `2026-02-30` is refused.
- `show_in_app` says so when an id doesn't exist, instead of "Opened".
- Smaller fixes: titles are kept on one line, whitespace-only titles and outline section names that already exist are refused, `add_broll` refuses notes and images, clearer messages for missing sources and for groups outside the `project` guard, and the web connector's `add_image` takes only a web address.
- Claude's `edit_note` refuses anything that isn't a note, instead of changing a source.
- Removing text (in the reader or from Claude) also removes the highlights inside the cut, and Undo says when there is nothing left to undo.
- Claude's replies are clearer: `add_links` says what `allow_duplicates` did, arXiv papers are labelled arXiv, the web connector no longer offers desktop-only features, and archiving a project explains what went wrong when it fails.
- Captured math, tables, footnotes and Substack posts on custom domains come out cleaner.
- The local copy keeps binary files (images, PDFs) intact.

## 0.5.0 (2026-10-24)

### New

- **TL;DRs for your sources, in the desktop app.** Every source you save gets a short TL;DR: one sentence with the gist, 3 to 5 key points and the part most worth reading. It shows under each title in the group list, and a pane on the right shows the full TL;DR of the source you're on, so you can move down a group with `j`/`k`, press `1`/`2`/`3` to keep, maybe or cut, and only open what's worth reading. When the article has its own summary (Wikipedia's lead, a Reddit post's "TL;DR:"), Sourcefold uses that and no AI is involved. Otherwise it's written by the AI you pick in **Settings → TL;DR**: **Sign in with ChatGPT** to use your ChatGPT plan, or paste an OpenRouter or OpenCode key and pick any model, free ones included. Sources you saved before get TL;DRs only for the groups you choose (**Write TL;DRs** in a group's menu or header), so your plan's usage isn't spent on your whole library. `w` writes one again, `b` hides or shows the pane, and the reader shows the TL;DR under the title. TL;DRs stay out of your `.md` files.

## 0.4.1 (2026-10-23)

### New

- **The extension signs in by itself.** Click **Sign in with Google** in the popup (or in Options) and the extension saves to your account and Google Drive without the website or the desktop app. With the desktop app open and signed in, it uses the app's sign-in instead, so signing in is optional. The website address and access token are gone from Options.

### Fixed

- The extension works with the 0.4.0 desktop app again. It said "Can't read the desktop app's sign-in" because the app now shares its sign-in in a new form.
- Paid Substack posts you subscribe to are saved in full, not as "Paid post, not saved", on pages that show a subscribe or paywall box outside the post (such as the substack.com reader).
- Saving a Grokipedia article from the extension said "Something went wrong. Try again." when the extension was signed in by itself. The extension's background couldn't turn the article into Markdown because it has no page to parse the HTML with.

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
