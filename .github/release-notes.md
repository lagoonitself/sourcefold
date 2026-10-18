Sourcefold saves everything you read (web pages, YouTube transcripts, PDFs, Wikipedia, Grokipedia, Substack, Reddit, Hacker News, Bluesky and X) as clean Markdown in folders. Read it, highlight it, search inside it, and copy it to your own Google Drive, ready for NotebookLM, Gemini or any AI tool.

## Download

| Get                                          | File                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Windows** 10 or 11                         | [Sourcefold-Windows-Setup.exe](https://github.com/{{REPO}}/releases/download/{{TAG}}/Sourcefold-Windows-Setup.exe)       |
| **Mac** (macOS 11+, Apple Silicon or Intel)  | [Sourcefold-Mac.dmg](https://github.com/{{REPO}}/releases/download/{{TAG}}/Sourcefold-Mac.dmg)                           |
| **Chrome extension** (also Edge, Brave, Arc) | [Sourcefold-Chrome-Extension.zip](https://github.com/{{REPO}}/releases/download/{{TAG}}/Sourcefold-Chrome-Extension.zip) |
| **Claude Desktop** extension                 | [Sourcefold-Claude.mcpb](https://github.com/{{REPO}}/releases/download/{{TAG}}/Sourcefold-Claude.mcpb)                   |
| **Website** (nothing to install)             | {{WEB_URL}}                                                                                                              |

## What's new in {{VERSION}}

{{CHANGES}}

## Install in two minutes

Full steps, with what to click on each warning: [INSTALL.md](https://github.com/{{REPO}}/blob/{{TAG}}/docs/INSTALL.md).

**Windows:** run `Sourcefold-Windows-Setup.exe`. If Windows says "Windows protected your PC", click **More info**, then **Run anyway**.

**Mac:** open `Sourcefold-Mac.dmg` and drag Sourcefold into Applications. The first time it's blocked: open **System Settings → Privacy & Security** and click **Open Anyway**. If macOS says the app "is damaged", run this in Terminal and open it again:

```
xattr -dr com.apple.quarantine /Applications/Sourcefold.app
```

Then click **Sign in with browser** (the website address is filled in) and **Connect**, or **Use offline on this computer**.

**Extension:** unzip `Sourcefold-Chrome-Extension.zip` somewhere permanent. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the unzipped folder. With the desktop app open, it saves through the app; nothing else to set up. Without it, see [INSTALL.md](https://github.com/{{REPO}}/blob/{{TAG}}/docs/INSTALL.md#chrome-extension).

**Claude Desktop:** in the desktop app open **Settings → Claude** and click **Add to Claude Desktop**, then **Install** in Claude Desktop. Or double-click `Sourcefold-Claude.mcpb`. Then ask Claude "List my Sourcefold projects".

**Updating:** run the new installer; your library is kept. For the extension, unzip the new version over the old folder and click reload on `chrome://extensions`.

## Everything Sourcefold does

- **Save:** paste 30-40 links at once; save the page you're on with the extension (`Alt+Shift+S`); save whole YouTube playlists and channels, or a Substack publication between two dates, in the desktop app.
- **Read and highlight** (desktop): a clean reader, highlights with notes, quotes copied with their source, and every source an article cites, ready to save.
- **Search** (desktop): inside every source in a project, by keyword or by meaning, all on your computer.
- **Organize:** projects, groups inside groups, notes and images, drag and drop, archiving.
- **Claude:** ask Claude Desktop to list, read, add, organize, highlight and save your sources for you.
- **Your files:** every source is a Markdown file. **Save to Drive** mirrors your folders into your own Google Drive with a Google Doc copy of each; the desktop app keeps a copy with Word files in `Documents/Sourcefold`, or works fully offline.

Supported sources, and which part does what: [README](https://github.com/{{REPO}}#readme).
