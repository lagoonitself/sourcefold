# Contributing to Sourcefold

Thanks for helping. Sourcefold is a small, self-hosted tool, so changes should keep it simple, free to run, and private by default.

## Before you start

- For anything bigger than a small fix, open an issue first and describe what you want to change.
- Read [docs/SPEC.md](docs/SPEC.md) for how the app works. For UI changes, follow [docs/DESIGN.md](docs/DESIGN.md) (tokens, fonts and copy rules).
- Sourcefold must keep running on free tiers. Don't add paid services or heavy dependencies.

## Set up

Follow the README to create your own Supabase project, Google OAuth client and `apps/web/.env.local`, then:

```bash
npm install
npm run dev                              # web app on http://localhost:3000
npm run build -w @sourcefold/extension   # load apps/extension/.output/chrome-mv3 in Chrome
```

## Before you open a pull request

Run these from the repo root. CI runs the same checks.

```bash
npm run format
npm run lint
npm run typecheck
npm test
```

- Keep each pull request to one change, and explain what it fixes and how you tested it.
- Database changes go in a new file in `supabase/migrations/`. Don't edit migrations that already exist.
- Never commit secrets. Real values belong in `apps/web/.env.local`, which is gitignored.
- Parsers for Grokipedia, Substack and X live in `packages/core` and `apps/extension/lib/x`. If a site changes its HTML, add a fixture and a test with the fix.

## Reporting bugs

Open an issue with the steps to reproduce, what you expected, and what happened. For a page that won't save, include its link. Don't paste tokens, keys or your `.env.local`.
