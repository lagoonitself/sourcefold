# Sourcefold Desktop

A fast, completely local, privacy-first desktop research archive built with **Tauri v2**, **React 19**, **Tailwind CSS v4**, and embedded **SQLite** (`rusqlite`).

Works seamlessly on both **macOS** and **Windows**.

---

## Key Features

- **100% Local & Privacy-First**:
  - Embedded **SQLite database** stored locally at `%LOCALAPPDATA%\Sourcefold\sourcefold.db` (Windows) or `~/Library/Application Support/Sourcefold/sourcefold.db` (macOS).
  - All articles, Substack newsletters, and X / Twitter threads are saved directly to your local file system as clean **Markdown** files (default: `Documents/Sourcefold/`) with YAML frontmatter.
  - Zero cloud dependencies: No Supabase, no Google Drive, no external accounts needed.

- **1Password-Style Chrome Native Messaging**:
  - The desktop app includes an integrated Chrome Native Messaging Host (`com.sourcefold.native`).
  - The Chrome extension connects directly to the desktop app over standard I/O pipes.
  - No API keys, no passwords, and no tokens required.
  - Automatic fallback to an embedded local HTTP loopback server (`http://127.0.0.1:23456`) with full CORS support.

- **Deep Research Organization**:
  - **Hierarchical Project & Folder Tree**: Infinite nesting, folder reordering with drag-and-drop, and project-level archiving.
  - **Multi-Source Mark Support**: Distinctive badges and styling for Grokipedia, Substack, X/Twitter, Notes, and Images.
  - **X / Twitter Thread Preservation**: Captures multi-tweet threads in order, linking parent/child tweet nodes together.
  - **Grokipedia Deep Scraper**: Cleans DOM, strips ads/noise, and turns inline references into proper Markdown footnotes (`[^1]`).
  - **Bulk Link Importer**: Paste 30–40 URLs at once to batch scrape and catalog articles with real-time status queues.
  - **Instant Search**: `Cmd+K` / `Ctrl+K` searches across titles, personal notes, URLs, and Markdown content.

---

## Directory Structure

```text
apps/desktop/
├── src/                          # React 19 Frontend
│   ├── components/ui/            # Button, Input, Dialog, DropdownMenu
│   ├── features/
│   │   ├── drive/                # DriveSyncStatus and drive API
│   │   ├── folders/              # Hierarchical folder tree with dnd-kit
│   │   ├── grokipedia/           # Bulk link importer and scraper modal
│   │   ├── items/                # Item list, note editor, item mover
│   │   ├── projects/             # Project switcher and project manager
│   │   ├── reader/               # Markdown document reader view and modal
│   │   ├── search/               # Global search dialog (Cmd+K)
│   │   ├── settings/             # Settings dialog & native host status
│   │   └── shortcuts/            # Keyboard shortcuts dialog & hook
│   ├── lib/                      # api.ts (Tauri IPC + fallback), types.ts
│   ├── App.tsx                   # Main dual-pane layout
│   └── main.tsx                  # React entrypoint
└── src-tauri/                    # Rust Tauri v2 Backend
    ├── src/
    │   ├── commands/             # Tauri IPC commands (folders, items, settings)
    │   ├── db.rs                 # Embedded SQLite schema, migrations, queries
    │   ├── models.rs             # Serde data transfer models
    │   ├── native_host.rs        # Chrome Native Messaging stdio binary host
    │   ├── native_installer.rs   # Windows Registry & macOS host auto-installer
    │   ├── server.rs             # Embedded local HTTP loopback server (port 23456)
    │   ├── lib.rs                # Library exports
    │   └── main.rs               # Process entrypoint & CLI dispatcher
    ├── Cargo.toml                # Rust dependencies
    └── tauri.conf.json           # Tauri v2 bundle & window configuration
```

---

## Development & Running

### Prerequisites

- Node.js >= 24
- Rust >= 1.77 (`rustup`)
- On Windows: Visual Studio C++ Build Tools & WebView2
- On macOS: Xcode Command Line Tools

### 1. Run in Development Mode

From the repository root:

```bash
npm run tauri dev -w @sourcefold/desktop
```

Or from `apps/desktop`:

```bash
npm run tauri dev
```

This spins up the Vite dev server and launches the native desktop window with hot reloading.

### 2. Run Tests

Run the Rust test suite in `apps/desktop/src-tauri`:

```bash
cd apps/desktop/src-tauri
cargo test
```

### 3. Build Production Installer / Binary

From `apps/desktop`:

```bash
npm run tauri build
```

- **Windows**: Outputs `.exe` and `.msi` in `src-tauri/target/release/bundle/`.
- **macOS**: Outputs `.app` and `.dmg` in `src-tauri/target/release/bundle/`.

---

## Chrome Extension Setup

1. Build the extension:
   ```bash
   npm run build -w @sourcefold/extension
   ```
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right.
4. Click **Load unpacked** and select the `apps/extension/.output/chrome-mv3` directory.
5. In the extension popup or options, Connection Mode defaults to **Auto (Native messaging with local HTTP fallback)**. It connects directly to your desktop app!

---

## Builds and releases

### Continuous Integration (CI)

Since local development takes place on Windows, GitHub Actions CI (`.github/workflows/desktop.yml`) provides automated build and test coverage for both **Windows** (`windows-latest`) and **macOS** (`macos-latest`, Apple Silicon) on every push to `main` and on pull requests:

- Sets up Node.js 24 and Rust stable toolchains with cargo caching (`Swatinem/rust-cache`).
- Builds the Vite frontend (`npm run build -w @sourcefold/desktop`).
- Lints with Cargo Clippy (`cargo clippy -- -D warnings`).
- Runs backend unit and integration tests (`cargo test`).
- Performs a bundle-less debug compile (`npx tauri build --debug --no-bundle`) to verify native linking.

### Cutting a Release

To cut a new release:

1. Ensure the version matches in `apps/desktop/src-tauri/tauri.conf.json` and `apps/desktop/package.json` (e.g. `0.1.0`).
2. Create and push a release tag matching `desktop-v*`:
   ```bash
   git tag desktop-v0.1.0
   git push origin desktop-v0.1.0
   ```
3. Alternatively, trigger the **Desktop Release** workflow manually from the GitHub Actions tab via `workflow_dispatch`.

### Release Artifacts & Installers

The release workflow (`.github/workflows/desktop-release.yml`) builds installers across platforms and publishes them to a **Draft Release** on GitHub:

- **Windows (`windows-latest`)**:
  - `.msi`: Windows Installer (WiX)
  - `.exe`: Setup installer (NSIS)
- **macOS (`macos-latest`)**:
  - `.dmg`: Universal disk image containing a universal binary (`universal-apple-darwin`) supporting both Apple Silicon (M-series / `aarch64`) and Intel (`x86_64`) Macs in a single download.
  - `.app`: Application bundle.

### Unsigned Application Caveats

Sourcefold is maintained under a $0 budget without paid Apple Developer or Microsoft Authenticode certificates. Consequently, operating systems will display security warnings on first launch:

- **macOS (Gatekeeper)**:
  - When opening the downloaded `.dmg` or `.app` for the first time, macOS will display an alert stating that the app cannot be opened because Apple cannot check it for malicious software.
  - **To bypass**: Right-click (or Control-click) the application icon, click **Open** from the context menu, and click **Open** again in the confirmation dialog. You can also allow it under **System Settings > Privacy & Security**.
- **Windows (SmartScreen)**:
  - Windows Defender SmartScreen may display a "Windows protected your PC" banner.
  - **To bypass**: Click **More info**, followed by **Run anyway**.
