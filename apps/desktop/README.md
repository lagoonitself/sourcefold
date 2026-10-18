# Sourcefold desktop app

The Windows and Mac app, built with Tauri v2 (React 19, Tailwind CSS v4, Rust, embedded SQLite). To install it, see [docs/INSTALL.md](../../docs/INSTALL.md). This page is for working on it.

## Two modes

- **Signed in:** talks to a Sourcefold website's API with a personal token (from **Sign in with browser** → **Connect** on `/desktop/connect`). Desktop and website share one library; text lives in Google Drive. Data refreshes on focus and every 30 seconds, and a local copy of every file is kept in `Documents/Sourcefold` (`src-tauri/src/local_copy.rs`).
- **Offline:** everything is in SQLite (`%LOCALAPPDATA%\Sourcefold\sourcefold.db` on Windows, `~/Library/Application Support/Sourcefold/sourcefold.db` on Mac) and Markdown files in `Documents/Sourcefold`. No account or network needed.

The Chrome extension reaches the app through Chrome Native Messaging (`com.sourcefold.native`, registered on every start) or the loopback server on `http://127.0.0.1:23456`, which only answers the pinned Sourcefold extension.

## Layout

```text
apps/desktop/
├── src/                     React frontend
│   ├── features/            one folder per feature: reader, highlights, search, sources (Add links),
│   │                        substack, items, folders, projects, settings, shortcuts, local-copy, …
│   └── lib/                 api.ts (Tauri IPC or web API), types
└── src-tauri/src/           Rust
    ├── commands/            Tauri commands the frontend calls
    ├── db.rs, service.rs    SQLite schema and the offline library
    ├── search/              per-project full-text index and vector store
    ├── local_copy.rs        signed-in copy of every file on disk
    ├── server.rs            loopback HTTP server for the extension
    ├── native_host.rs       Native Messaging host (the same binary, started by Chrome)
    └── substack.rs, web_fetch.rs   fetching pages on your own connection
```

`src/lib/__tests__/ipc-contract.test.ts` checks every frontend `tauriInvoke` call against the Rust commands, so keep it passing when you add one.

## Run it

You need Node.js 24, Rust (`rustup`), and on Windows the Visual Studio C++ Build Tools and WebView2, on Mac the Xcode Command Line Tools.

```bash
npm install                                  # from the repo root
npm run tauri dev -w @sourcefold/desktop     # dev window with hot reload
npm test -w @sourcefold/desktop              # frontend tests
cd apps/desktop/src-tauri && cargo test      # Rust tests
cargo clippy --all-targets -- -D warnings    # CI fails on any warning
```

`npm run tauri -- build` (from `apps/desktop`) builds an installer into `src-tauri/target/release/bundle/`.

## CI and releases

- **Desktop CI** (`.github/workflows/desktop.yml`) builds, lints and tests on Windows and Mac on every push to `main` and every pull request.
- **Release** (`.github/workflows/desktop-release.yml`) runs when a `v*` tag is pushed. It builds `Sourcefold-Windows-Setup.exe` (NSIS), a universal `Sourcefold-Mac.dmg` (Apple Silicon and Intel, ad-hoc signed) and `Sourcefold-Chrome-Extension.zip`, and publishes them with the tag's section of `CHANGELOG.md`.

To cut a release:

1. Set the same version in `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml` (and `Cargo.lock`), `apps/extension/package.json` and `apps/extension/wxt.config.ts`.
2. Add a `## <version> (<date>)` section to `CHANGELOG.md`.
3. Commit, then `git tag v<version>` and `git push origin v<version>`.

The apps aren't signed with paid certificates, so Windows SmartScreen and macOS Gatekeeper warn on first launch. [docs/INSTALL.md](../../docs/INSTALL.md) explains what to click.
