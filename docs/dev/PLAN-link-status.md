# Clear status for links that wait for your computer

The owner asked (2026-11-06): links Claude adds on the web that need the desktop app (YouTube, Reddit, refused pages) or the desktop app and Chrome (X posts) give no clear sign of whether they were saved. The popup says "needs your OK, Allow", the desktop says "N need Chrome", and nothing says what happened afterwards. Build one reliable, clear way for both kinds, and make the process sturdier.

## What was wrong

- Nobody knew whether the desktop app or the extension was actually running, so every place could only say "waiting".
- Results were never shown: the desktop toasted only its own batch; the extension's saves showed nowhere; the popup's progress line vanished when done.
- X needed an extra **Allow** click in the popup (optional host permission), and the popup had to be opened to see it.
- A failed link stayed "failed" for 7 days with no way to dismiss it.
- The extension looked for work once a minute.

## Design

1. **Check-ins** (`supabase/migrations/20261108000000_link_workers.sql`). `link_workers (user_id, worker_id, kind 'desktop'|'extension', can_run, version, seen_at)`, written only by `link_worker_check_in(p_worker, p_kind, p_can_run, p_version, p_user_id)`. The desktop checks in every 60 s while signed in and open; the extension every 30 s (its alarm), with `can_run` = signed in and the desktop app reachable.
2. **One vocabulary** (`packages/core/src/link-status.ts`): `describeQueuedLink(row, seen, now)` → `{state, label, hint, needsYou, done}` and `summarizeLinks(rows, seen)` → counts and the one next step. States: `waiting_desktop`, `waiting_chrome`, `waiting_both`, `up_next`, `saving`, `needs_allow`, `needs_sign_in`, `saved`, `duplicate`, `unavailable`, `failed`, `cancelled`. A helper counts as running if it checked in within 150 s. `seen = null` (older server) falls back to neutral wording. Every app uses this; none writes its own.
3. **Routes** (shared router + website): `GET /api/link-queue/workers` → `{desktop_seen_at, extension_seen_at, extension_can_run}`; `POST /api/link-queue/workers` `{worker, kind, can_run?, version?}` (worker id must be `desktop:<id>` / `extension:<id>` matching `kind`). `DELETE /api/link-queue/{id}` now also dismisses a `failed` row (sets `cancelled`). Existing: `GET /api/link-queue?status=recent` (7 days), `PATCH /api/link-queue/{id}` `{status:"waiting", needs}` = Retry.
4. **Extension**: `https://x.com/*` and `https://twitter.com/*` become required host permissions (no Allow for X; Allow stays for other sites). Alarm every 30 s, plus a check-in each tick. Badge: orange count of links that need the person; after a run that saved something, a green "✓" for a few seconds. Popup: a "Links from Claude" list (last 7 days, newest first, up to 20) with each link's title or address, its group, `label` and `hint`, and Retry / Dismiss / Allow where they apply; saved rows link to the page.
5. **Desktop**: check-in every 60 s while signed in. The top-bar pill becomes a button whenever there are open links or results from the last 24 h not yet seen; it opens a "Links from Claude" panel with the same list (saved → opens the source in the app; Retry, Dismiss; group path). While anything is open the panel data refreshes every 10 s; links that the extension saved since the last look are announced once in a toast ("Chrome saved 2 links Claude added").
6. **Claude (MCP)**: `add_links` and `get_add_progress` read `/link-queue/workers` (ignoring a failure) and use `describeQueuedLink` / `summarizeLinks`: each link's label and hint, and one closing line with the next step (for example "Open Chrome with the Sourcefold extension to save 2 X posts. Your desktop app is open.").

## Not changed

- Chrome links still run only while the desktop app is open (the owner's rule from `handoff-web-mcp.md`).
- The website has no list of waiting links yet.
