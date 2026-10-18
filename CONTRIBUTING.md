# Contributing to Sourcefold

Thanks for helping. Sourcefold is a small, self-hosted tool, so changes should keep it simple, free to run, and private by default.

## Before you start

- For anything bigger than a small fix, open an issue first and describe what you want to change.
- Read [docs/dev/SPEC.md](docs/dev/SPEC.md) for how the app works. For UI changes, follow [docs/dev/DESIGN.md](docs/dev/DESIGN.md) (tokens, fonts and copy rules).
- Sourcefold must keep running on free tiers. Don't add paid services or heavy dependencies.

## Set up

Follow [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) to create your own Supabase project, Google OAuth client and `apps/web/.env.local`, then from the repo root:

```bash
npm install
npm run dev                              # website on http://localhost:3000
npm run tauri dev -w @sourcefold/desktop # desktop app (see apps/desktop/README.md)
npm run build -w @sourcefold/extension   # load apps/extension/.output/chrome-mv3 in Chrome
```

## Where things are

- `apps/web`: the website and its API (Next.js on Vercel)
- `apps/desktop`: the Windows and Mac app (Tauri v2, React, Rust, SQLite); see [its README](apps/desktop/README.md)
- `apps/extension`: the Chrome extension (Manifest V3, WXT, React)
- `packages/core`: parsers and Markdown builders shared by all three
- `packages/client`: the website's API logic, being moved here so the apps can run without the website
- `supabase/migrations`: the database schema
- `docs/`: user guides ([INSTALL](docs/INSTALL.md), [SELF-HOSTING](docs/SELF-HOSTING.md), [FILE-FORMAT](docs/FILE-FORMAT.md)). `docs/dev/` has the [spec](docs/dev/SPEC.md), the [design guide](docs/dev/DESIGN.md), the [roadmap](docs/dev/ROADMAP.md) and working notes.

## Before you open a pull request

Run these from the repo root. CI runs the same checks.

```bash
npm run format
npm run lint
npm run typecheck
npm test
# desktop changes:
cd apps/desktop/src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

- Keep each pull request to one change, and explain what it fixes and how you tested it.
- Changes people will notice get a line in [CHANGELOG.md](CHANGELOG.md) under the next version.
- Database changes go in a new file in `supabase/migrations/`. Don't edit migrations that already exist.
- Never commit secrets. Real values belong in `apps/web/.env.local`, which is gitignored.
- Parsers for every source live in `packages/core` (X's in `apps/extension/lib/x`). If a site changes its HTML, add a fixture and a test with the fix.

## Releasing

Bump the version, add a `CHANGELOG.md` section, and push a `v*` tag. The steps are in [apps/desktop/README.md](apps/desktop/README.md#ci-and-releases).

## Reporting bugs

Open an issue with the steps to reproduce, what you expected, and what happened. For a page that won't save, include its link. Don't paste tokens, keys or your `.env.local`.
