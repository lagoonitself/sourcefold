# Sourcefold

A personal research source collector. Save Grokipedia articles, Substack posts and X posts into folders, keep each one as clean Markdown, and push everything to Google Drive with one button so it can go straight into NotebookLM, Gemini or any other tool.

- **Chrome extension:** save the page you are on into any folder in one click.
- **Bulk add:** paste 30-40 Grokipedia links at once.
- **Markdown first:** every source is a `.md` file with a small header (source link, author, dates).
- **Read at the source:** clicking an item opens the original page.
- **Google Drive:** one Save button mirrors your folders and files into Drive.

> **Status:** feature-complete and being tested. See [docs/ROADMAP.md](docs/ROADMAP.md) for what is done and what is left, and [docs/SPEC.md](docs/SPEC.md) for the full spec.

## Stack

- Web app: Next.js (TypeScript) on Vercel
- Database, login and file storage: Supabase (Postgres, Auth with Google, Storage)
- Browser extension: Chrome (Manifest V3), built with WXT
- Storage mirror: Google Drive API (`drive.file` scope only)

## What you need

- Free accounts: GitHub, Supabase, Google Cloud, and Vercel
- Node.js 24
- Google Chrome

## 1. Supabase

1. Create a free project in [Supabase](https://supabase.com). Pick the region nearest to you.
2. Apply the SQL migration files in `supabase/migrations/` in filename order. You can run them in the Supabase SQL Editor or run `supabase db push` with the Supabase CLI:
   - `supabase/migrations/20261013000000_initial_schema.sql`
   - `supabase/migrations/20261013010000_drive_sync.sql`
   - `supabase/migrations/20261013020000_image_storage.sql`
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
   - Go to **Clients** (or **Credentials** → **Create Credentials** → **OAuth client ID**).
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

   | Variable                               | Where to find it                                      | Used for                                                                  |
   | -------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`             | Supabase Dashboard → Project Settings → API Keys      | Project URL for database and auth requests                                |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Dashboard → Project Settings → API Keys      | Public key used in browser and server requests                            |
   | `ALLOWED_EMAIL`                        | Your Google account email address                     | The only Google account allowed to sign in (comma-separated list allowed) |
   | `SUPABASE_SECRET_KEY`                  | Supabase Dashboard → Project Settings → API Keys      | Server-only key used for extension token lookups and Drive sync           |
   | `GOOGLE_CLIENT_ID`                     | Google Cloud Console → Google Auth Platform → Clients | OAuth client ID used to refresh Drive access tokens                       |
   | `GOOGLE_CLIENT_SECRET`                 | Google Cloud Console → Google Auth Platform → Clients | OAuth client secret used to refresh Drive access tokens                   |

   `ALLOWED_EMAIL` defines the only Google account allowed to sign in to this deployment. A comma-separated list of emails is allowed.

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

1. Build the extension package:
   ```bash
   npm run build -w @sourcefold/extension
   ```
2. Load the unpacked extension in Chrome:
   - Open `chrome://extensions`.
   - Turn on **Developer mode** in the top-right corner.
   - Click **Load unpacked** and select `apps/extension/.output/chrome-mv3`.
3. Connect the extension to your app:
   - In the Sourcefold web app, open **Settings** and generate a new access token.
   - In the extension settings (right-click the extension icon and select **Options**, or click the gear icon in the popup), enter your app address (`http://localhost:3000` or `https://<app>.vercel.app`) and paste the access token.
   - Click **Test connection** to verify connectivity.
4. Shortcuts and actions:
   - Press `Alt+Shift+S` to open the extension popup and save the current tab.
   - Right-click any Grokipedia link and select **Save link to Sourcefold** to queue the article without opening it.

## Using it

- **Folders:** organize sources in nested folders of unlimited depth. Drag and drop folders in the sidebar to reorder or nest them.
- **Add links:** paste 30-40 Grokipedia links into the "Add links" dialog to import articles sequentially.
- **Extension:** save Grokipedia articles, Substack posts (free posts and paid posts you subscribe to), and X threads into your chosen folder with one click.
- **Notes and images:** create standalone Markdown notes, add notes to saved sources, or upload research images into any folder.
- **Save to Drive:** click "Save to Drive" or press `Ctrl+S` to mirror your folders, Markdown files, and images into a `Sourcefold` folder in Google Drive. Deletions in Sourcefold move corresponding files and folders to Google Drive's trash.

## Development

Run development commands from the repository root:

```bash
npm run dev                         # web app on http://localhost:3000
npm run lint && npm run typecheck && npm test
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=placeholder npm run build -w @sourcefold/web
npm run build -w @sourcefold/extension   # load apps/extension/.output/chrome-mv3 as an unpacked extension
npm run format                      # Prettier; CI runs format:check
```

Repository layout:

- `apps/web`: Next.js web application and API routes
- `apps/extension`: Chrome extension (Manifest V3) built with WXT and React
- `packages/core`: shared library for parsing, Markdown generation, and types
- `supabase`: SQL migrations and database configuration

For contributor guidelines and agent instructions, see [AGENTS.md](AGENTS.md). For complete architecture and specifications, see [docs/](docs/).

## Troubleshooting

- **Sign-in loops back to `/login`:** verify that your Google account email is included in `ALLOWED_EMAIL`. Check that your redirect URL (`http://localhost:3000/**` or `https://<app>.vercel.app/**`) is configured under Supabase Authentication → URL Configuration.
- **"Reconnect Drive" keeps appearing:** check that your Google Cloud OAuth app status is set to "In production" under Audience rather than "Testing" mode. Also make sure you granted consent for the Google Drive scope (`drive.file`) during sign-in.
- **Supabase project paused:** free-tier Supabase projects pause after about 7 days without activity. Open your Supabase dashboard and restore the project. Ensure the `APP_URL` repository variable is set in GitHub so the daily keep-alive workflow pings `/api/health`.
- **Extension says token invalid:** personal access tokens can be revoked or recreated. Open Settings in the web app, generate a new access token, and paste it into the extension settings.

## License

[MIT](LICENSE)
