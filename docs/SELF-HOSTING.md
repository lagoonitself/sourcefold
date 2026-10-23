# Run your own copy of Sourcefold

This guide sets up your own Sourcefold website, so you control the database, who can sign in and which Google account owns everything. It takes about an hour and runs on free tiers.

You don't need it to use Sourcefold. If someone already runs a Sourcefold website for you, follow [INSTALL.md](INSTALL.md) instead.

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
   - In **Branding**, set the application name (for example, `Sourcefold`). You can provide a link to your privacy policy using [PRIVACY.md](../PRIVACY.md) in your GitHub repository.
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

## 5. Build your own installers (optional)

GitHub can build the Windows and Mac apps and the Chrome extension for you, already pointed at your website.

1. Fork this repository (or push it to your own GitHub account).
2. Set the repository variable `SOURCEFOLD_WEB_URL` to your website address:
   ```bash
   gh variable set SOURCEFOLD_WEB_URL --body https://<app>.vercel.app
   ```
3. Add a section for the new version to [CHANGELOG.md](../CHANGELOG.md), then push a version tag:
   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```

The **Release** workflow builds `Sourcefold-Windows-Setup.exe`, `Sourcefold-Mac.dmg` and `Sourcefold-Chrome-Extension.zip`, attaches them to a GitHub release with the install guide, and publishes it. Share the release link; [INSTALL.md](INSTALL.md) walks people through the rest.

## 6. Install the Chrome extension

1. Get the extension, either way:
   - **Download:** grab `Sourcefold-Chrome-Extension.zip` from the [latest release](https://github.com/lagoonitself/sourcefold/releases/latest) and unzip it into a folder.
   - **Build it yourself:** run `npm run build -w @sourcefold/extension`. The output is `apps/extension/.output/chrome-mv3`.
2. Load the unpacked extension in Chrome:
   - Open `chrome://extensions`.
   - Turn on **Developer mode** in the top-right corner.
   - Click **Load unpacked** and select the unzipped folder (or `apps/extension/.output/chrome-mv3`).
3. Connection modes:
   - **Auto (default):** when the extension is signed in (popup or Options → **Sign in with Google**), saves go straight to your account: the extension runs the same API code as the website inside its background worker, against Supabase and Google Drive. Otherwise it asks the desktop app over Chrome Native Messaging or local HTTP (`127.0.0.1:23456`): signed in, the extension borrows its access token; offline, saves go to the local SQLite library.
   - **Desktop app only:** saves only through the desktop app (its sign-in or its offline library).
4. Your own Supabase project: build with `WXT_SUPABASE_URL` and `WXT_SUPABASE_PUBLISHABLE_KEY` (the release workflow takes them from the `SOURCEFOLD_SUPABASE_URL` and `SOURCEFOLD_SUPABASE_PUBLISHABLE_KEY` repository variables), or set them in Options → **Advanced**. In Supabase → Authentication → URL Configuration, add `https://<extension id>.chromiumapp.org/**` to the redirect URLs (the extension's ID comes from the `key` in `apps/extension/wxt.config.ts`).
5. Shortcuts and actions:
   - Press `Alt+Shift+S` to open the extension popup and save the current tab. The popup shows where saves will land.
   - Right-click any Grokipedia link and select **Save link to Sourcefold** to queue the article without opening it.

## 7. Desktop app

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

See [apps/desktop/README.md](../apps/desktop/README.md) for full details, architecture, keyboard shortcuts, and packaging instructions.

## How it fits together

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
