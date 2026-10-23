# Sourcefold

[![Latest release](https://img.shields.io/github/v/release/lagoonitself/sourcefold?label=download)](https://github.com/lagoonitself/sourcefold/releases/latest)
[![CI](https://github.com/lagoonitself/sourcefold/actions/workflows/ci.yml/badge.svg)](https://github.com/lagoonitself/sourcefold/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Save everything you read for a project (articles, YouTube transcripts, Wikipedia and Grokipedia, Substack, Reddit, X, PDFs) as clean Markdown in folders. Read it, highlight it, search inside it, and send it to your Google Drive ready for NotebookLM, Gemini or any AI tool.

Built for people who gather a lot of reading before they write or make a video. See it in action at **[sourcefold-site.vercel.app](https://sourcefold-site.vercel.app)**.

## Download

| Get                                          | File                                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Windows** 10 or 11                         | [Sourcefold-Windows-Setup.exe](https://github.com/lagoonitself/sourcefold/releases/latest/download/Sourcefold-Windows-Setup.exe)                                   |
| **Mac** (macOS 11+, Apple Silicon or Intel)  | [Sourcefold-Mac.dmg](https://github.com/lagoonitself/sourcefold/releases/latest/download/Sourcefold-Mac.dmg)                                                       |
| **Chrome extension** (also Edge, Brave, Arc) | [Sourcefold-Chrome-Extension.zip](https://github.com/lagoonitself/sourcefold/releases/latest/download/Sourcefold-Chrome-Extension.zip)                             |
| **Claude Desktop** extension                 | [Sourcefold-Claude.mcpb](https://github.com/lagoonitself/sourcefold/releases/latest/download/Sourcefold-Claude.mcpb) (or **Settings → Claude** in the desktop app) |
| **Website** (nothing to install)             | Ask whoever runs your Sourcefold for the address, or [run your own](docs/SELF-HOSTING.md)                                                                          |

The apps aren't from a paid publisher, so Windows and macOS warn you the first time you open them. **[INSTALL.md](docs/INSTALL.md)** shows the two clicks that get past it, how to load the extension, and how to sign in. What changed in each version is in [CHANGELOG.md](CHANGELOG.md); older downloads are on the [releases page](https://github.com/lagoonitself/sourcefold/releases).

## What it does

**Save from anywhere**

- Paste 30-40 links at once, in any mix, and watch each one save.
- Save the page you're on with the extension (`Alt+Shift+S`), or right-click a Grokipedia link to save it without opening it.
- Save a whole YouTube playlist or channel, or a whole Substack publication between two dates, in the desktop app.

**Read and highlight**

- Every source opens in a clean reader in the desktop app: no ads, images in place, footnotes that jump to their references.
- Select text to highlight it, add a note, and copy a quote with its source. Highlights are written into the source's Markdown file too.
- Don't want all of it? Remove the parts you don't need (a sponsor read in a transcript, a "related articles" list) and keep the rest; Undo brings it back.
- On Grokipedia and Wikipedia, see every source an article cites and save the ones you want in one go.

**Find things again**

- Search inside every source in a project, not just titles. Use `"exact phrases"` and `-word`.
- Turn on search by meaning and find a passage even when it uses different words. It runs on your computer; nothing is sent anywhere.

**Organize**

- Projects (one per video or article you're working on), with groups inside groups as deep as you like. Drag to reorder and nest.
- Notes and images next to your sources. Select sources to move them or copy their links.
- Archive a project when you're done with it.

**Work with Claude**

- Add Sourcefold to Claude Desktop (desktop app: **Settings → Claude → Add to Claude Desktop**) and ask Claude to do anything you do: list and read your sources, add a YouTube playlist to a group, move or delete sources, highlight passages, write notes, save to Drive.
- It uses the desktop app's sign-in, so there's nothing to set up. With the desktop app open, Claude can also search inside your sources and open things in the app for you. See [INSTALL.md](docs/INSTALL.md#claude-desktop).

**Your files, your Drive**

- Every source is a tidy `.md` file with a small header (link, author, dates) and references as footnotes. See [FILE-FORMAT.md](docs/FILE-FORMAT.md).
- **Save to Drive** (`Ctrl+S`) mirrors your folders into a `Sourcefold` folder in your own Google Drive, with a Google Doc copy of each source. Sourcefold can only see files it created there.
- The desktop app keeps a copy in `Documents/Sourcefold`, with a Word `.docx` beside each file, so Obsidian, VS Code or any AI tool can read them.
- Or skip the cloud: the desktop app works offline with no account at all.

## Which one should I use?

All three work together. Signed in, whatever you save from one shows up in the others.

|                                   | Website    | Desktop app                | Extension              |
| --------------------------------- | ---------- | -------------------------- | ---------------------- |
| Paste links in bulk               | ✓          | ✓                          |                        |
| Save the page you're on           |            |                            | ✓                      |
| YouTube transcripts               |            | ✓ plus playlists, channels | ✓                      |
| Substack                          |            | ✓ plus whole publications  | ✓                      |
| X posts and threads               |            |                            | ✓                      |
| Read, highlight and take notes    | notes only | ✓                          |                        |
| Search                            | titles     | ✓ inside sources           |                        |
| Copy to Google Drive              | ✓          | ✓ when signed in           | ✓ when signed in       |
| Works offline, without an account |            | ✓                          | ✓ with the desktop app |

A good setup is the desktop app plus the extension. The website is handy on a computer where you can't install anything.

## Supported sources

| Source        | Save it with                     | What you get                                                                                              |
| ------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Grokipedia    | Any of the three, or right-click | The full article with tables, links and every reference as a footnote                                     |
| Wikipedia     | Any of the three                 | The full article with its infobox, images and references                                                  |
| YouTube       | Desktop app or extension         | The English transcript in timestamped paragraphs that open the video at that second, plus the description |
| Substack      | Desktop app or extension         | Free posts, and paid posts you subscribe to, with their images                                            |
| X             | Extension                        | A single post or the author's whole thread, replies kept as a tree                                        |
| Reddit        | Extension, with the thread open  | The post and its comments                                                                                 |
| Hacker News   | Any of the three                 | The story and its comment thread                                                                          |
| Bluesky       | Any of the three                 | The post or thread                                                                                        |
| PDF and arXiv | Website or desktop app           | The document's text, with math kept                                                                       |
| Any web page  | Any of the three                 | The main article (news, blogs, docs), without menus and ads                                               |

Some sites (Reddit, DeepMind, Meta AI, paywalled news) refuse pasted links. Save those with the extension while the page is open; it saves the page as you see it.

## Run your own copy

Sourcefold is free and open source, and runs entirely on free tiers (Vercel, Supabase, Google Cloud). [SELF-HOSTING.md](docs/SELF-HOSTING.md) walks through setting up your own website, choosing who can sign in, and building installers that point at it.

## Help and contributing

- Something broke? [Open an issue](https://github.com/lagoonitself/sourcefold/issues) with the link that failed and what you saw.
- Want to change something? See [CONTRIBUTING.md](CONTRIBUTING.md).
- What Sourcefold stores and why: [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)
