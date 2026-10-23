# Install Sourcefold

Sourcefold has three parts. You can use any of them alone, but they work best together:

- **Website:** nothing to install. Sign in with Google, paste links, save to Drive.
- **Desktop app** for Windows and Mac: faster, reads and highlights your sources, searches inside them, saves YouTube, and works offline.
- **Chrome extension:** saves the page you're on with one click.

Everything you save is private to you. Signed in, your sources go into a `Sourcefold` folder in **your own** Google Drive, and Sourcefold can only see the files it created there.

All downloads are on the [latest release](https://github.com/lagoonitself/sourcefold/releases/latest).

## Website

1. Open your Sourcefold website (the address you were given, or [your own](SELF-HOSTING.md)) and click **Sign in with Google**.
2. Google asks to let Sourcefold see and manage the files it creates in your Drive. Allow it.
3. Make a project and a group, click **Add links**, paste one or more links, and they save. Press **Save to Drive** (or `Ctrl+S`) to copy everything to your Drive.

## Desktop app

### Windows 10 or 11

1. Download [Sourcefold-Windows-Setup.exe](https://github.com/lagoonitself/sourcefold/releases/latest/download/Sourcefold-Windows-Setup.exe).
2. Double-click it. Windows may say "Windows protected your PC" because the app isn't from a paid publisher. Click **More info**, then **Run anyway**.
3. Finish the installer, then open **Sourcefold** from the Start menu.

### Mac (macOS 11 or newer, Apple Silicon or Intel)

1. Download [Sourcefold-Mac.dmg](https://github.com/lagoonitself/sourcefold/releases/latest/download/Sourcefold-Mac.dmg).
2. Open it and drag **Sourcefold** into **Applications**.
3. The first time, macOS blocks it because the app isn't from a paid Apple developer. To allow it:
   - Open **Sourcefold** from Applications. When macOS says it can't be opened, click **Done** (or **OK**).
   - Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to "Sourcefold was blocked", then confirm with your password.
   - If macOS says the app **"is damaged and can't be opened"**, open **Terminal**, run this, and open the app again:
     ```
     xattr -dr com.apple.quarantine /Applications/Sourcefold.app
     ```
4. After that it opens normally.

### Sign in, or use it offline

1. On the welcome screen, click **Sign in with Google**.
2. Your browser opens Google. Pick your account and allow access; the page then says "Signed in".
3. Back in the app, your projects appear. The app works on its own and doesn't need the website open; the website shows the same library.

Prefer not to sign in? Click **Use offline on this computer**. Everything stays in `Documents/Sourcefold` on this computer.

### First things to try

- **Add links** to paste links, including a YouTube playlist or a Substack address.
- `Enter` on a source opens the reader. Select text to highlight it.
- `/` searches inside your sources. To search by meaning too, open **Settings → Search** (a one-time 175 MB download).
- `?` lists every keyboard shortcut; `Ctrl+K` (`Cmd+K` on Mac) runs any command.

## Chrome extension

Works in Chrome, Edge, Brave and Arc.

1. Download [Sourcefold-Chrome-Extension.zip](https://github.com/lagoonitself/sourcefold/releases/latest/download/Sourcefold-Chrome-Extension.zip) and unzip it. Keep the unzipped folder somewhere permanent (for example in Documents), because the browser loads it from there.
2. Open `chrome://extensions` (in Edge: `edge://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the unzipped folder (the one that contains `manifest.json`).
5. Click the puzzle-piece icon in the toolbar and pin **Sourcefold**.
6. Connect it:
   - **With the desktop app:** keep the app open. That's all; the extension saves through it, signed in or offline.
   - **With the website only:** on the website open **Settings**, click **Create token** under Extension and copy the token. Then right-click the Sourcefold icon, choose **Options**, set **Connection mode** to **Web app only**, check the website address, paste the token into **Access token**, click **Save**, then **Test connection**. Allow access to the site if the browser asks.
7. Open any article or video and click the Sourcefold icon (or press `Alt+Shift+S`), pick a group and press **Save**. The popup remembers your project for next time.

## Claude Desktop

Lets Claude read, add and organize your library from a normal Claude chat. You need [Claude Desktop](https://claude.com/download) on the same computer.

1. **With the desktop app** (easiest): open Sourcefold's **Settings → Claude** and click **Add to Claude Desktop**. Claude Desktop opens an install window: click **Install**. Claude uses the desktop app's sign-in, so leave the settings empty.
2. **Without the desktop app:** download [Sourcefold-Claude.mcpb](https://github.com/lagoonitself/sourcefold/releases/latest/download/Sourcefold-Claude.mcpb) and double-click it (or drag it onto Claude Desktop). On the website open **Settings**, click **Create token** and paste it into **Access token** in the install window. Fill in **Website address** only if your website isn't the one the download was built for.
3. Start a new chat in Claude Desktop and ask, for example, "List my Sourcefold projects" or "Add this YouTube playlist to my Cars › Turbo group". The first time Claude uses a Sourcefold tool it asks for permission; choose **Always allow** for the ones you're happy with.

Claude Desktop starts Sourcefold by itself whenever it runs; there is nothing to keep open. With the Sourcefold desktop app open as well, Claude can also search inside your sources, open a source or highlight in the app for you, and save paid Substack posts with your cookie. X posts still need the browser extension.

Other AI apps that support MCP (Claude Code, Cursor and others) can run the same server: unzip the `.mcpb` and run `node server/index.mjs` from that folder as a stdio MCP server, for example `claude mcp add sourcefold -- node /path/to/unzipped/server/index.mjs`.

## Updating

Download the new installer from the [latest release](https://github.com/lagoonitself/sourcefold/releases/latest) and run it; your library is kept. For Claude Desktop, click **Add to Claude Desktop** again (or open the new `.mcpb`). For the extension, unzip the new version over the old folder and click the reload icon on Sourcefold in `chrome://extensions`.

## Problems?

- **"This account can't use Sourcefold"** when signing in: the website only lets in the people its owner chose. Ask them to add you.
- **Reddit, DeepMind, Meta AI or some news sites fail when pasted:** they block servers or build the page with JavaScript. Save them with the extension while the page is open.
- **YouTube on the website:** YouTube blocks servers. Use the desktop app or the extension.
- **A saved page seems to be missing:** a group lists only its own sources, not its subgroups'. The extension shows the full path when it saves (for example `Cars / Engines`).
- **Extension says the token is invalid:** create a new token in the website's **Settings** and paste it into the extension's options.

Still stuck? [Open an issue](https://github.com/lagoonitself/sourcefold/issues).
