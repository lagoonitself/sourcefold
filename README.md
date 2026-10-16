# Sourcefold

[![CI](https://github.com/lagoonitself/sourcefold/actions/workflows/ci.yml/badge.svg)](https://github.com/lagoonitself/sourcefold/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Collect research sources into folders as clean Markdown, then send them to Google Drive with one click, ready for NotebookLM, Gemini or any other AI tool.

Sourcefold is built for people who gather a lot of reading before they write or make a video. Save Grokipedia and Wikipedia articles, YouTube transcripts, Reddit and Hacker News threads, Substack posts, X and Bluesky posts, PDFs, arXiv papers and almost any article or blog post on the web, from a Chrome extension or by pasting a batch of links. Sourcefold turns each one into a tidy `.md` file, sorts it into nested folders, and mirrors those folders into a `Sourcefold` folder in your Drive.

- **Desktop app:** fast native app for Windows and macOS (Tauri v2 + React 19 + Rust). Works signed in (connected to your web account) or offline (local SQLite library on disk).
- **Chrome extension:** save the page you're on into any folder in one click. Auto mode routes saves to your web account or local desktop app. Right-click a Grokipedia link to save it without opening it.
- **Bulk add:** paste 30-40 links at once (any mix of supported sources) and watch each one import.
- **Markdown first:** every source becomes a `.md` file with a small header (source link, author, dates) and references kept as footnotes.
- **Folders inside folders:** unlimited depth, with drag-and-drop to reorder and nest.
- **Notes and images:** write Markdown notes or upload images next to your sources.
- **Google Drive:** one **Save to Drive** button (or `Ctrl+S`) mirrors your folders and files. Sourcefold only asks for the `drive.file` scope, so it can't see anything else in your Drive.
- **Self-hosted and free:** runs entirely on free tiers (Vercel, Supabase, Google Cloud). You decide who can sign in: just you, a list of friends, or anyone with a Google account.

Sourcefold doesn't show source content inside the app. Clicking an item opens the original page; the Markdown is for your AI tools.

## Just want to use it?

If someone shared their Sourcefold with you, you don't need to set anything up. Open the [latest release](https://github.com/lagoonitself/sourcefold/releases/latest) for the website address, the Windows and Mac installers, the Chrome extension, and step-by-step install instructions. The rest of this README is for running your own copy.

## Supported sources

| Source        | How to save                                      | What you get                                                                                              |
| ------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Grokipedia    | Extension, right-click, or "Add links"           | Full article with tables, links and every reference as a footnote                                         |
| Wikipedia     | Extension or "Add links"                         | Full article with its references                                                                          |
| YouTube       | Extension (on the video page) or the desktop app | The transcript in timestamped paragraphs, plus the description. Playlists and channels in the desktop app |
| Reddit        | Extension, "Add links", or the desktop app       | The post and its comments                                                                                 |
| Hacker News   | Extension, "Add links", or the desktop app       | The story and its comment thread                                                                          |
| Substack      | Extension                                        | Free posts, plus paid posts you subscribe to (locked posts are marked, not saved)                         |
| X             | Extension                                        | A single post or the author's whole thread, text only, replies kept as a tree                             |
| Bluesky       | Extension, "Add links", or the desktop app       | The post or thread                                                                                        |
| PDF and arXiv | Extension, "Add links", or the desktop app       | The document's text                                                                                       |
| Any web page  | Extension, "Add links", or the desktop app       | The main article (news, blogs, docs), without menus and ads                                               |

YouTube only works from the extension or the desktop app, because YouTube blocks requests from servers. A site that blocks servers or needs a login works best from the extension, which saves the page as you see it.

## Stack

- Web app: Next.js (TypeScript) on Vercel
- Desktop app: Tauri v2 (React 19 + Rust + SQLite)
- Database and login: Supabase (Postgres, Auth with Google). It keeps links, titles and folders; article text and images move to Drive
- Browser extension: Chrome (Manifest V3), built with WXT and React
- Content storage: Google Drive API (`drive.file` scope only)

## What you need

- Free accounts: GitHub, Supabase, Google Cloud, and Vercel
- Node.js 24
- Google Chrome

## 1. Supabase

1. Create a free project in [Supabase](https://supabase.com). Pick the region nearest to you.
2. Apply **every** SQL file in `supabase/migrations/`, oldest first (the file names sort by date). Paste each one into the Supabase SQL Editor and run it, or run `supabase link` then `supabase db push` with the Supabase CLI.
3. Configure authentication providers in **Authentication** → **Sign In / Providers**:
   - Enable **Google**. Paste the Google client ID and secret from step 2.
   - Disable **Email**. Do not disable "Allow new users to sign up", or your Google account will be unable to register on first sign-in.
4. Configure URLs in **Authentication** → **URL Configuration**:
   - Set **Site URL** to `http://localhost:3000` (update this to your deployed Vercel URL later).
   - Under **Redirect URLs**, add `http://localhost:3000/**` (and your deployed Vercel redirect URL later).
5. Copy project API keys in **Project Settings** → **API Keys**:
   - Copy the **Project URL** and the **publishable key** (starts with `sb_publishable_`).
   - Copy the **secret key** (starts with `sb_secret_`).

## 2. Google Cloud

1. Create a new project in the [Google Cloud Console](https://console.cloud.google.com).
2. Enable the Google Drive API: go to **APIs & Services** → **Enable APIs and Services**, search for `Google Drive API`, and enable it.
3. Configure the OAuth consent screen:
   - Go to **Google Auth Platform** (or **APIs & Services** → **OAuth consent screen**).
   - In **Branding**, set the application name (for example, `Sourcefold`). You can provide a link to your privacy policy using [PRIVACY.md](PRIVACY.md) in your GitHub repository.
   - In **Audience**, select **External**.
   - In **Data access**, click **Add or remove scopes** and add `https://www.googleapis.com/auth/drive.file`.
4. Create web application OAuth client credentials:
   - Choose **Clients** (or **Credentials** → **Create Credentials** → **OAuth client ID**).
   - Choose **Web application** as the application type.
   - Under **Authorized JavaScript origins**, add `http://localhost:3000` (and add your deployed Vercel URL later).
   - Under **Authorized redirect URIs**, add `https://<your-project-ref>.supabase.co/auth/v1/callback` (replace `<your-project-ref>` with your Supabase project reference).
   - Copy the **Client ID** and **Client Secret**.
5. Publish the application:
   - In **Audience**, click **Publish app** to move the app status to production. In testing mode, Google expires refresh tokens after 7 days, which breaks background Google Drive syncing.

## 3. Run locally

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/<your-username>/sourcefold.git
   cd sourcefold
   npm install
   ```
2. Copy `apps/web/.env.example` to `apps/web/.env.local`:
   ```bash
   cp apps/web/.env.example apps/web/.env.local
   ```
3. Fill in every variable in `apps/web/.env.local`:

   | Variable                               | Where to find it                                      | Used for                                                        |
   | -------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`             | Supabase Dashboard → Project Settings → API Keys      | Project URL for database and auth requests                      |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Dashboard → Project Settings → API Keys      | Public key used in browser and server requests                  |
   | `ALLOWED_EMAIL`                        | Your Google account email address                     | Who can sign in: comma-separated emails, or `*` for anyone      |
   | `SUPABASE_SECRET_KEY`                  | Supabase Dashboard → Project Settings → API Keys      | Server-only key used for extension token lookups and Drive sync |
   | `GOOGLE_CLIENT_ID`                     | Google Cloud Console → Google Auth Platform → Clients | OAuth client ID used to refresh Drive access tokens             |
   | `GOOGLE_CLIENT_SECRET`                 | Google Cloud Console → Google Auth Platform → Clients | OAuth client secret used to refresh Drive access tokens         |

   `ALLOWED_EMAIL` decides who can sign in to this deployment: one email, a comma-separated list, or `*` to let any Google account sign up. Each person only ever sees their own sources. With `*`, the Google OAuth app must be published (step 2.5), or only its test users can sign in.

4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:3000` in Chrome and sign in with your Google account.

## 4. Deploy to Vercel

1. Import your GitHub repository into [Vercel](https://vercel.com).
2. Configure the deployment settings:
   - Set **Root Directory** to `apps/web`.
   - Set **Framework Preset** to `Next.js`.
3. Add the environment variables from `apps/web/.env.local` to the Vercel project settings (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ALLOWED_EMAIL`, `SUPABASE_SECRET_KEY`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`).
4. Deploy the project. Note your production URL (for example, `https://<app>.vercel.app`).
5. Update your OAuth and Supabase redirect URLs:
   - In Google Cloud Console: add `https://<app>.vercel.app` to **Authorized JavaScript origins** on your web client.
   - In Supabase: under **Authentication** → **URL Configuration**, update **Site URL** to `https://<app>.vercel.app` and add `https://<app>.vercel.app/**` to **Redirect URLs**.
6. Set the GitHub repository variable `APP_URL` so the daily keep-alive workflow keeps Supabase from pausing your project:
   ```bash
   gh variable set APP_URL --body https://<app>.vercel.app
   ```

## 5. Install the Chrome extension

1. Get the extension, either way:
   - **Download:** grab `sourcefold-extension-chrome.zip` from the [latest release](https://github.com/lagoonitself/sourcefold/releases/latest) and unzip it into a folder.
   - **Build it yourself:** run `npm run build -w @sourcefold/extension`. The output is `apps/extension/.output/chrome-mv3`.
2. Load the unpacked extension in Chrome:
   - Open `chrome://extensions`.
   - Turn on **Developer mode** in the top-right corner.
   - Click **Load unpacked** and select the unzipped folder (or `apps/extension/.output/chrome-mv3`).
3. Connection modes:
   - **Auto (default):** the extension talks to the desktop app over Chrome Native Messaging or local HTTP (`127.0.0.1:23456`). If the desktop app is signed in, saves go to your account through the web API. If the desktop app is offline, saves go to your local SQLite library. If the desktop app is closed, saves fall back to your configured web app address and access token.
   - **Desktop app only:** saves only to the desktop app (account or offline library).
   - **Web app only:** saves directly to the web app address and access token configured in extension options.
4. Set up web app fallback:
   - In the Sourcefold web app, open **Settings** and generate a new access token.
   - In extension options (right-click the extension icon and select **Options**, or click the gear icon in the popup), enter your web address (`http://localhost:3000` or `https://<app>.vercel.app`) and paste the access token.
   - Click **Test connection** to verify connectivity.
5. Shortcuts and actions:
   - Press `Alt+Shift+S` to open the extension popup and save the current tab. The popup shows where saves will land.
   - Right-click any Grokipedia link and select **Save link to Sourcefold** to queue the article without opening it.

## 6. Desktop app

Sourcefold includes a native desktop application for Windows and macOS built with Tauri v2, React 19, Tailwind CSS v4, and Rust.

The desktop app runs in two modes:

- **Signed in:** connects to your web deployment with a personal API token. Desktop and web share the same projects, groups, and sources. Article text and images live in Google Drive. Data refreshes on window focus and every 30 seconds.
- **Offline:** stores all data locally in embedded SQLite (`%LOCALAPPDATA%\Sourcefold\sourcefold.db` on Windows, `~/Library/Application Support/Sourcefold/sourcefold.db` on macOS) and saves Markdown files to disk (`Documents/Sourcefold/`). Works with zero cloud dependencies.

To run the desktop app in development:

```bash
npm run tauri dev -w @sourcefold/desktop
```

Or from `apps/desktop`:

```bash
npm run tauri dev
```

To sign in from the desktop app:

1. Open desktop Settings (`Mod+,`).
2. Enter your web app address (`http://localhost:3000` or `https://<app>.vercel.app`).
3. Click **Sign in with browser**.
4. In the browser tab that opens, click **Connect**. The web app creates a personal access token named "Sourcefold Desktop" and redirects back to the desktop app.

See [apps/desktop/README.md](apps/desktop/README.md) for full details, architecture, keyboard shortcuts, and packaging instructions.

## Using it

- **Folders:** organize sources in nested folders of unlimited depth. Drag and drop folders in the sidebar to reorder or nest them.
- **Add links:** paste 30-40 links into the "Add links" dialog to import them one after another.
- **Extension:** save the page you're on into your chosen folder with one click: any source in the table under [Supported sources](#supported-sources), including Substack posts you subscribe to, X threads and YouTube transcripts.
- **Notes and images:** create standalone Markdown notes, add notes to saved sources, or upload research images into any folder.
- **Save to Drive:** click "Save to Drive" or press `Ctrl+S` to mirror your folders, Markdown files, and images into a `Sourcefold` folder in Google Drive. Deletions in Sourcefold move corresponding files and folders to Google Drive's trash.

## Development

Run development commands from the repository root:

```bash
npm run dev                         # web app on http://localhost:3000
npm run lint && npm run typecheck && npm test
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=placeholder npm run build -w @sourcefold/web
npm run build -w @sourcefold/extension   # load apps/extension/.output/chrome-mv3 as an unpacked extension
npm run tauri dev -w @sourcefold/desktop # desktop app development
npm run format                      # Prettier; CI runs format:check
```

Repository layout:

- `apps/web`: Next.js web application and API routes
- `apps/desktop`: Tauri v2 desktop application (React 19 + Rust + SQLite)
- `apps/extension`: Chrome extension (Manifest V3) built with WXT and React
- `packages/core`: shared library for parsing, Markdown generation, and types
- `supabase`: SQL migrations and database configuration

For how to contribute, see [CONTRIBUTING.md](CONTRIBUTING.md). Rules for AI coding agents are in [AGENTS.md](AGENTS.md). The full product and technical spec is [docs/SPEC.md](docs/SPEC.md), the file and folder layout format is [docs/FILE-FORMAT.md](docs/FILE-FORMAT.md), the visual system is [docs/DESIGN.md](docs/DESIGN.md), and [docs/ROADMAP.md](docs/ROADMAP.md) lists what's done and what's next.

### How it fits together

1. The web app (Next.js on Vercel) stores folders and items in Supabase Postgres, with row-level security on every table.
2. The desktop app (Tauri v2) connects to the web app's API with an access token, or works offline using local SQLite and local files on disk.
3. Grokipedia, Wikipedia, Reddit, Hacker News, Bluesky, PDF and web page links are fetched and converted to Markdown on the server or in the desktop app. YouTube is fetched by the extension or the desktop app on your own connection, since YouTube blocks servers. Substack and X pages are read by the extension in your own browser (so paid posts you subscribe to work) and sent to `/api/capture`.
4. The extension communicates with the desktop app via Chrome Native Messaging or local HTTP (`127.0.0.1:23456`), or directly with the web app using a personal access token.
5. Save to Drive runs in small batches: it creates the folder tree, uploads changed `.md` files and images, and moves deleted ones to Drive's trash.

## Troubleshooting

- **Sign-in loops back to `/login`:** verify that your Google account email is included in `ALLOWED_EMAIL`. Check that your redirect URL (`http://localhost:3000/**` or `https://<app>.vercel.app/**`) is configured under Supabase Authentication → URL Configuration.
- **"Reconnect Drive" keeps appearing, even right after reconnecting:** the Google client in Supabase (Authentication → Sign In / Providers → Google) must be the same one as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in your app. A Google refresh token only works with the client that issued it. If they differ, Save to Drive says the clients don't match; copy the same ID and secret into both places, redeploy, and reconnect.
- **"Reconnect Drive" appears after about a week:** check that your Google Cloud OAuth app status is set to "In production" under Audience rather than "Testing" mode. Also make sure you granted consent for the Google Drive scope (`drive.file`) during sign-in.
- **Supabase project paused:** free-tier Supabase projects pause after about 7 days without activity. Open your Supabase dashboard and restore the project. Ensure the `APP_URL` repository variable is set in GitHub so the daily keep-alive workflow pings `/api/health`.
- **A saved page seems to be missing:** a group only lists its own sources, not the sources in its subgroups, and the sidebar only shows the open project. The extension tells you the full path when it saves (for example `Cars / Engines`). A page can be saved in several groups, so saving it again into another group is fine.
- **Extension says token invalid:** personal access tokens can be revoked or recreated. Open Settings in the web app, generate a new access token, and paste it into the extension settings.

## License

[MIT](LICENSE)
