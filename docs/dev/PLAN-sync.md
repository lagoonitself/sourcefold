# Live sync between computers

The owner asked (2026-11-05) for sync "like Notion or Google Docs": add a source on one computer, and another computer signed in to the same Google account shows it, with its `.md` file in the local folder, without waiting. This file is the plan and the record of what was built.

## What already worked, and what didn't

Signed in, every app (desktop, website, extension, Claude) reads and writes the same Supabase account, and article text goes to Google Drive. So the data was already shared. What was missing was the second computer _noticing_:

- The desktop reloaded its views only on window focus and every 30 s while visible, and the local copy (`Documents/Sourcefold`) followed the same timer.
- The website reloaded only when you navigated.
- A local copy run that came while another was running was skipped (`RUNNING` in `local_copy.rs` answers "busy"), so a change could wait a full extra cycle.

Offline mode (desktop signed out, SQLite on disk) stays separate: it has no account, so nothing syncs. Moving an offline library into the account is still the "Import an offline desktop library" idea in Next steps.

## Why not R2

The owner suggested Cloudflare R2. It isn't the missing piece here: Supabase already holds every change from every device, and Drive already holds the text. R2 would be a third copy of the same text, and its access key can't ship inside the desktop app or the extension (anyone could read every library with it), so it would also need a server to hand out signed links. What sync needed was a push signal. R2 stays planned for shared projects (`PLAN-sharing.md`, phase 2), where content has to live outside one person's Drive.

## Design

Supabase Realtime **Broadcast from the database**, one private channel per account. Events are only a wake-up call; each device then pulls the real state the way it already does. So a missed, late or duplicated event can never lose or corrupt anything, and the 30 s timer stays as the safety net.

1. **Database** (`supabase/migrations/20261106000000_live_sync.sql`):
   - `public.notify_sync()`: a statement-level trigger function. For each account touched by the statement it sends one message with `realtime.send(payload, 'change', 'sync:<user_id>', true)`. Payload: `{ table, op, n (rows), ids (first 25 row ids), device }`. Never the row itself, so 200 KB articles never go over the socket. One message per statement, so moving 800 sources is one message, not 800.
   - `device` is the `x-sourcefold-device` request header (each desktop install sends its own id), so a device can ignore the echo of its own writes. Writes from elsewhere (Claude, the extension, the website) have none or another id.
   - Any error inside the trigger is caught and dropped: a sync signal must never fail a save.
   - Triggers (insert, update, delete; transition tables need one trigger per event) on `folders`, `items`, `highlights`, `cards`, `outline_sections`, `item_tldrs`, `x_posts`, `shelf_links`, `link_queue`.
   - RLS on `realtime.messages`: an authenticated user may receive broadcasts only on the topic `sync:<their own id>`.
2. **Client library** (`packages/client`): `createSupabase` takes an optional `deviceId` and sends it as `x-sourcefold-device` on every request. `createLiveSync` (`src/live-sync.ts`) owns the channel:
   - Subscribes to `sync:<user id>` (private) after setting the Realtime token; joins again with backoff (1 s, doubling to 30 s) after an error, timeout or close; re-sends the token when Supabase refreshes it.
   - Coalesces bursts: the first event starts a 400 ms window, extended by later ones up to 2 s, then one `onChange(batch)` call with every table and id seen.
   - Calls `onCatchUp()` whenever the channel (re)joins, and when the browser comes back online or the window becomes visible after being hidden, because events sent while disconnected are gone.
   - Reports its state (`connecting`, `live`, `offline`, `off`) to listeners.
3. **Desktop** (`apps/desktop/src/features/sync/`): signed in, `LiveSyncProvider` starts live sync with a per-install device id (localStorage `sourcefold:device_id`). On a change or a catch-up it fires `sourcefold:refresh` (every view already reloads on it) and runs the local copy. `syncLocalCopy` now queues one more run when asked while a run is going, instead of dropping the request.
4. **Website** (`apps/web/src/features/sync/live-refresh.tsx`): the same channel, calling `router.refresh()` on a change.
5. **Status:** Settings → Account shows "Live sync: On", "Connecting…" or "Offline, will catch up when back". The top bar gains nothing (the owner wants the UI left as it is).

## Limits

- Free plan: 200 concurrent Realtime connections and 2 million messages a month; one connection per open app and a few messages per change is far inside that.
- An article open in the reader isn't reloaded under you when another computer edits it; the list, highlights panel and files are.
- If Realtime is down, sync falls back to the old 30 s / focus refresh.

## Testing

- `packages/client`: unit tests for the coalescing, echo skipping, reconnect backoff and catch-up (fake channel).
- Database: trigger checked on the live project inside a transaction that is rolled back.
- Owner: two computers (or the desktop app and the website side by side) signed in to the same account; steps in `HANDOFF.md`.
