# Rules for coding agents

Read `docs/SPEC.md` before starting. For any UI work, also read `docs/DESIGN.md` and use only its tokens, fonts and copy rules. The spec, the design guide and this file are the authority. If a task brief conflicts with them, the task brief wins for that task. If something is unclear or a decision is not covered, stop and report the question instead of guessing.

## Working rules

- Do **not** run `git commit`, `git push`, `git reset`, `git checkout` or `git stash`. The orchestrator reviews and commits.
- Do **not** add dependencies unless your brief lists them. If you need one, finish what you can and report it.
- Only edit files your brief says you own. Several agents work in this checkout at the same time.
- Never write secrets into tracked files. Real values go in `apps/web/.env.local` (gitignored); placeholders go in `apps/web/.env.example`.
- Before reporting done, run `npm run lint`, `npm run typecheck` and `npm test` from the repo root and fix what you broke.
- Your final report must list: files created or changed, commands run and their results, anything left unfinished, and any question for the orchestrator.

## Stack

- Node 24, npm workspaces. Packages: `@sourcefold/web` (`apps/web`), `@sourcefold/core` (`packages/core`), later `@sourcefold/extension` (`apps/extension`).
- TypeScript everywhere, `strict: true`, ES modules.
- Web: Next.js App Router with a `src/` directory, Tailwind CSS v4, shadcn/ui components, `lucide-react` icons, `zod` for request validation.
- Data: `@supabase/supabase-js` + `@supabase/ssr`. No ORM. Database types are generated into `apps/web/src/lib/database.types.ts` (do not hand-edit).
- Core: plain TypeScript consumed from source by Next (`transpilePackages`). Tests with Vitest.
- Lint/format: ESLint (flat config) and Prettier (defaults, `printWidth` 100).

## Code conventions

- Server-side Supabase client: `apps/web/src/lib/supabase/server.ts`. Browser client: `apps/web/src/lib/supabase/client.ts`. Do not create others.
- API routes live in `apps/web/src/app/api/**/route.ts`. Validate input with zod, return JSON `{ data }` or `{ error: { message } }` with a proper status code.
- All database access goes through RLS as the signed-in user unless the brief says otherwise.
- Keep components small. Feature code goes in `apps/web/src/features/<feature>/`. Shared UI primitives come from shadcn in `apps/web/src/components/ui/`.
- Prefer clear names over comments. Comment only non-obvious logic.
