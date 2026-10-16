Sourcefold saves the things you read (web pages, YouTube transcripts, PDFs, Wikipedia, Grokipedia, Substack, Reddit, Hacker News, Bluesky and X) as clean Markdown in folders, and copies them to your own Google Drive, ready for NotebookLM, Gemini or any AI tool.

**Website:** {{WEB_URL}}

All you need is a Google account. Your sources are private to you and go into a `Sourcefold` folder in **your own** Google Drive. Sourcefold can only see files it created there, nothing else in your Drive.

## 1. Use the website (no install)

1. Open {{WEB_URL}} and click **Sign in with Google**.
2. Google asks to let Sourcefold see and manage the files it creates in your Drive. Allow it.
3. Make a project and a group, click **Add links**, paste one or more links, and they save. Press **Save to Drive** (or `Ctrl+S`) to copy everything to your Drive.

## 2. Install the desktop app (optional)

The desktop app is faster, works offline, and can save YouTube videos. Download the file for your computer from **Assets** at the bottom of this page.

### Windows 10 or 11

1. Download **`Sourcefold_{{VERSION}}_x64-setup.exe`**.
2. Double-click it. Windows may say "Windows protected your PC" because the app isn't from a paid publisher. Click **More info**, then **Run anyway**.
3. Finish the installer, then open **Sourcefold** from the Start menu.

### Mac (macOS 11 or newer, Apple Silicon or Intel)

1. Download **`Sourcefold_{{VERSION}}_universal.dmg`**.
2. Open it and drag **Sourcefold** into **Applications**.
3. The first time, macOS blocks it because the app isn't from a paid Apple developer. To allow it:
   - Open **Sourcefold** from Applications. When macOS says it can't be opened, click **Done** (or **OK**).
   - Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to "Sourcefold was blocked", then confirm with your password.
   - If macOS says the app **"is damaged and can't be opened"**, open **Terminal** and run this, then open it again:
     ```
     xattr -dr com.apple.quarantine /Applications/Sourcefold.app
     ```
4. After that it opens normally.

### Sign in to the desktop app

1. On the welcome screen, check the address is {{WEB_URL}} and click **Sign in with browser**.
2. Your browser opens the Sourcefold website. Sign in with Google if asked, then click **Connect**.
3. Back in the app, your projects appear. Changes sync both ways with the website.

Prefer not to sign in? Click **Use offline on this computer**: everything stays in `Documents/Sourcefold` on this computer only.

## 3. Add the Chrome extension (optional)

The extension saves the page you're on with one click. It works in Chrome, Edge, Brave and Arc.

1. Download **`sourcefold-extension-chrome.zip`** from **Assets** below and unzip it. Keep the unzipped folder somewhere permanent (for example in Documents), because the browser loads it from there.
2. Open `chrome://extensions` (in Edge: `edge://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the unzipped folder (the one that contains `manifest.json`).
5. Click the puzzle-piece icon in the toolbar and pin **Sourcefold**.
6. Connect it:
   - **If you use the desktop app:** keep the app open and signed in. That's all; the extension saves through it.
   - **If you only use the website:** on the website open **Settings**, click **Create token** under Extension and copy the token. Then right-click the Sourcefold icon, choose **Options**, choose **Web app only** as the Connection mode, check the Web app address is {{WEB_URL}}, paste the token into **Access token**, click **Save**, then **Test connection**. Allow access to the site if the browser asks.
7. Open any article or video and click the Sourcefold icon (or press `Alt+Shift+S`), pick a group and click **Save**.

## Updating

Download the new installer from the newest release and run it; your library is kept. For the extension, unzip the new version over the old folder and click the reload icon on `chrome://extensions`.

## Problems?

- **"This account can't use Sourcefold"** when signing in: tell the person who sent you the link.
- **Reddit, DeepMind, Meta AI or some news sites fail on the website:** they block servers or build the page with JavaScript. Save them with the extension while the page is open.
- **YouTube on the website:** use the desktop app or the extension.
