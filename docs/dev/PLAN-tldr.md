# Plan: TL;DR for every source

Status: built 2026-10-24 on branch `tldr`, waiting for the owner's test. "As built" at the end says what differs from this plan. Desktop app only.

## What the owner asked for

Before reading a source, see a TL;DR of it, so time goes only to sources worth reading. When the article already has a TL;DR, use that. When it doesn't, an LLM writes one: GPT-6 Luna, using the owner's ChatGPT subscription through **Sign in with ChatGPT**, with no API key and no per-token bill.

## Decisions (2026-10-24)

- **Two sources of a TL;DR, in this order:** the article's own (found by code, free, instant), then ChatGPT. Finding the article's own is not a waste of time: it is one pure function in `packages/core` with fixtures, and it saves plan usage on every Wikipedia article, arXiv paper and Reddit post that ends with "TL;DR:". It only takes clear signals (below); everything else goes to ChatGPT.
- **Sign in with ChatGPT, the official route.** OpenAI opened ChatGPT plan usage to open-source, locally run apps (DevDay, 2026-09-29; docs at `developers.openai.com/siwc`, "open-source app"). Sourcefold qualifies: MIT and running on the user's computer. No partner approval, no client secret. Requests go to the normal Responses API at `https://api.openai.com/v1/responses` with the OAuth access token, and count against the user's ChatGPT plan. We don't use the Codex CLI or its login: that needs Codex installed and is the "legacy" route other apps are moving off.
- **A TL;DR is its own field, not "My summary".** The research tools decided that "Sourcefold never writes summaries itself"; `summary` stays the user's (or Claude's). A TL;DR is shown with where it came from ("From the article" or "Written by GPT-6 Luna").
- **TL;DRs stay out of the source's file.** The `.md` in Drive and on disk is what goes into NotebookLM and Gemini; AI-written text would end up treated as part of the source. The TL;DR lives in the database only (Supabase signed in, SQLite offline). If the owner wants it in the file later, it's one section in `docs/FILE-FORMAT.md`.
- **Owner's answers (2026-10-24):**
  - **Automatic:** every new save gets a TL;DR without pressing anything.
  - **Old sources only in the groups the owner picks**, never the whole library at once (the plan's usage is limited). A group is picked from its menu, in the sidebar or the group view, without opening it; ticking subgroups in select mode picks several. Nothing else in the backlog is touched.
  - **Out of the `.md` files.**
  - **Readable from the group list without opening the source:** every row shows its gist under the title, and the pane shows the full TL;DR of the focused row.
- **Desktop only**, like search inside sources. The extension's saves already go to the desktop app when it's running, so they get TL;DRs there. The website and extension don't call ChatGPT.

## What the user sees

### The TL;DR pane (the main thing)

The group view gets a pane on the right side of the sheet that shows the TL;DR of the **focused row**. Move with `j`/`k` (or the arrows) and the pane follows. No click, no dialog. Triage stays one key away, so the loop is: read the TL;DR, press `1` Keep, `2` Maybe or `3` Cut, `j` to the next one. Enter opens the reader as today.

```
│ Turbocharging                                  │ How twin-scroll turbos cut lag              │
│ 2 subgroups, 6 sources                         │ 7 min read, Grokipedia                      │
│                                                │                                             │
│ [tile] How twin-scroll turbos cut lag   ◂ focus│ Twin-scroll housings split exhaust pulses   │
│ [tile] BorgWarner EFR teardown                 │ so the turbine spools at lower revs.        │
│ [tile] Why diesels love turbos                 │                                             │
│                                                │ • Pulses from paired cylinders stay apart   │
│                                                │ • Spool starts about 500 rpm earlier        │
│                                                │ • Costs more and needs a matched manifold   │
│                                                │                                             │
│                                                │ Best part: "Pulse separation" section       │
│                                                │ Written by GPT-6 Luna                       │
│                                                │                                             │
│                                                │ [Keep 1] [Maybe 2] [Cut 3]       [Read ↵]  │
```

- Shown when the sheet is at least 960px wide; `b` shows or hides it (remembered). Narrower, `b` opens the same content as a popover next to the focused row.
- Content: title, reading time (word count at 230 words a minute; a video's duration), the **gist** (one sentence, Newsreader 17px), **3–5 key points**, **Best part** (the section, or the video time, most worth reading; clicking it opens the reader there), and where it came from in small muted text. The source's status buttons sit at the bottom, using the same keys as the list.
- States, each with one clear next action:
  - The article's own TL;DR: shown straight away, labelled "From the article".
  - Being written: three `.skeleton` lines shaped like the text.
  - None yet and not signed in: "Sign in with ChatGPT to get a TL;DR for sources that don't have one." with a button that opens Settings → ChatGPT.
  - None yet (an old source in a group that wasn't picked): **Write TL;DR** (`w`), for this one source only.
  - Failed: what happened and **Try again**.
  - Usage limit reached: "Your ChatGPT usage limit is reached, so TL;DRs are paused." with a link **Check usage** to `chatgpt.com/settings/usage`. No guessed reset time (OpenAI asks apps not to guess one).
  - Notes, images and sources with no text: "No text to summarize."
- Follows `docs/dev/DESIGN.md`: no new colours, no card shadow (the pane is the sheet with a 1px `--border` rule on its left), no "·"-joined meta, sentence case.

### In the list

- **Every row shows its gist** as the muted line under the title (one line, cut with an ellipsis), so a whole group can be skimmed without focusing or opening anything. The author, site, channel and duration that sit on that line today move to the pane. Rows without a TL;DR keep today's line. Rows don't change height. Settings → ChatGPT has **Show TL;DRs in the list** (on) for anyone who wants the old line back.
- `w` writes (or rewrites) the TL;DR for the focused row, or every ticked row in select mode. The select bar gets **Write TL;DRs**.
- A row whose TL;DR is being written shows a small spinner in its status column, with a tooltip.

### Picking groups for old sources

- Every group's menu (the three dots on its sidebar row, the group header's menu, and a subgroup row's menu) gets **Write TL;DRs for this group (N)**, where N counts the sources in that group without one. It works without opening the group, and asks first when N is over 25.
- In select mode, ticked subgroup rows get the same action in the select bar, for several groups at once.
- A picked group stays picked only until its sources are done; it is a one-off job, not a setting. New saves are covered anyway by the automatic TL;DR.
- While a group's job runs, its sidebar row shows the remaining count as a muted number with a spinner tooltip ("Writing TL;DRs, 12 left"). The job stops on the usage limit and continues from where it stopped after **Try again**.

### In the reader

A quiet TL;DR box under the title, above the source panel (gist and points; collapsible, remembered). Useful when a source is opened straight from search.

### Settings → ChatGPT (new section, after Claude)

- Signed out: one line about what it's for, **Sign in with ChatGPT** (opens the browser), and a note that source text is sent to OpenAI to write TL;DRs and counts against the ChatGPT plan.
- Signed in: the account email, whether plan usage was allowed on the consent page (if the user declined it: "Plan usage wasn't allowed. Sign in again and allow Use your ChatGPT plan."), the **Model** menu (from the account's own model list; defaults to GPT-6 Luna when listed), a switch **Write TL;DRs for new sources** (on by default), **Check usage**, and **Sign out**.
- Command palette: **Write TL;DRs for this group (N)** (the same action as the group menus above).

## How it works

### 1. The article's own TL;DR (`packages/core/src/tldr/author.ts`)

`findAuthorTldr({ kind, markdown, meta })` returns `{ gist, points } | null`. Clear signals only:

| Source                         | Signal                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wikipedia                      | The lead section (the text before the first heading), first 3 sentences as the gist; the short description stays out (too short).                                                                                                          |
| arXiv, PDFs                    | The abstract (`Abstract` heading or the arXiv abstract field).                                                                                                                                                                             |
| Reddit, Substack, web pages, X | A line or paragraph starting `TL;DR`, `TLDR`, `tl;dr:` or `Summary:`; a heading named "TL;DR", "Key takeaways", "Key points", "In brief", "In short", "Summary" or "Executive summary" near the start or end, with its list as the points. |
| Grokipedia                     | The lead paragraph when it is a real summary (not the meta description, which is often a fragment).                                                                                                                                        |
| YouTube, Hacker News, Bluesky  | Nothing; they go to ChatGPT.                                                                                                                                                                                                               |

Meta descriptions (`<meta name="description">`) are SEO text and are never used. Runs at save time in every client (it's cheap), and once over existing sources when the feature first starts.

### 2. Sign in with ChatGPT (Rust, `src-tauri/src/chatgpt/`)

Follows the open-source app guide. The pattern is the desktop's Google sign-in (`commands/auth.rs`: a `tiny_http` listener on `127.0.0.1`, system browser).

- **Host id:** `urn:uuid:<v4>`, made once per computer and kept in app data. **Client id:** the first sign-in sends `client_id=dynamic_agent_client` and `agent_name_hint=Sourcefold`; the redirect returns the real client id, which is saved and reused (otherwise every sign-in registers a new app with its own usage settings).
- **Authorize:** `https://auth.openai.com/api/accounts/authorize` with PKCE (S256), `state`, `nonce`, `redirect_uri=http://127.0.0.1:<port>/auth/callback` (`localhost` is refused), `resource=https://api.openai.com/v1`, scope `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`.
- **Token:** `https://auth.openai.com/api/accounts/oauth/token`. Check `state`, verify the ID token against OpenAI's JWKS (issuer, audience = client id, nonce), and check the granted scopes include `chatgpt.tokens.use.direct`.
- **Storage:** tokens in `<app data>/chatgpt_auth.json`, like the Substack cookie: never returned to the webview. The webview only sees `{ signedIn, email, planUsage, model }`.
- **Refresh:** access tokens last an hour, refresh tokens 30 days and rotate on every use. One refresh at a time behind a mutex (two at once would trip `refresh_token_reused` and sign the user out). Terminal refresh errors clear the tokens and ask to sign in again; network errors don't.
- **Commands:** `chatgpt_sign_in`, `chatgpt_status`, `chatgpt_sign_out` (revokes), `chatgpt_models` (`GET /v1/models`, keep `visibility == "list"` in the server's order), `chatgpt_respond`. Added to the IPC contract test.

### 3. Writing a TL;DR

- **Input, kept small on purpose** (`packages/core/src/tldr/input.ts`, `buildTldrInput`): a Grokipedia article is about 200 KB, and 800 of those would eat the plan. Send at most about 24,000 characters (around 6,000 tokens): title, source type, author, the heading outline, the lead, and the first paragraph of each section; for transcripts, evenly spaced windows with their times. Tested on the fixtures already in `packages/core`.
- **Request** (Rust `chatgpt_respond`): `POST /v1/responses` with `store: false`, `stream: true`, `instructions` (not a system message), and a JSON schema for the answer (`text.format`): `gist` (≤ 30 words), `points` (3–5, ≤ 20 words each), `best_part` (`{ section: number } | { time: string } | null`). None of the parameters the plan route refuses (`temperature`, `max_output_tokens`, …). The answer counts only after `response.completed`; `response.failed` is a failure.
- **Errors**, from OpenAI's list: `subscription_sharing_usage_limit_exceeded` (429) pauses the whole queue and shows the limit message; `subscription_sharing_user_not_eligible` (403, Free and Go plans) says so once and stops, no retry, no new sign-in; `…_usage_unavailable` and other 503s retry with bounded backoff (30 s, 2 min, then wait for **Try again**); `…_unsupported_capability` (400) is a bug, logged with `error.param`.
- **Queue** (`apps/desktop/src/features/tldr/`), three kinds of work, two TL;DRs at a time:
  - **New saves:** any source with no TL;DR saved after the feature first started (the start time is kept in settings). Old sources never match, so turning the feature on doesn't touch the backlog.
  - **Picked groups:** the group ids are kept in settings until each group has no source left without a TL;DR, so a job survives a restart and the usage-limit pause.
  - **`w`:** the focused or ticked sources, first in line.
  - The focused row goes first within each kind, then newest first. Text comes from `loadReaderText`, so it works signed in and offline.
- **When the text changes** (Remove text, Edit as text), the TL;DR is marked stale by a hash of the body and rewritten when auto is on; otherwise the pane says "The text changed since this TL;DR was written." with **Rewrite**.

### 4. Data

| Field         | Type                        | Notes                                                           |
| ------------- | --------------------------- | --------------------------------------------------------------- |
| `tldr`        | json, nullable              | `{ gist, points, best_part }`, at most 3,000 characters as text |
| `tldr_source` | `article` or `ai`, nullable |                                                                 |
| `tldr_model`  | text, nullable              | the model's display name, for "Written by …"                    |
| `tldr_at`     | timestamp, nullable         |                                                                 |
| `tldr_hash`   | text, nullable              | hash of the body it was written from                            |

- Supabase migration `…_tldr.sql` adds the columns to `items`. Changing a TL;DR must **not** move `items.updated_at` (that rebuilds the Drive file, Google Doc and local copy for nothing), so it goes through its own small update, not the normal item update.
- SQLite: the same columns, plus the `update_item_tldr` command offline.
- `packages/client` local API: `PATCH /api/items/<id>/tldr`; `GET /api/items` returns the fields.
- Project files (`.sourcefold`): the manifest carries the TL;DR, so an imported project keeps them (golden files updated).

### 5. Claude (later, small)

`list_sources` with `details` and `read_source`'s overview header show the gist. Claude can then triage hundreds of sources from TL;DRs without reading each one, which also saves the owner's Claude usage.

## Build order

1. **Spike (half a day):** a throwaway Rust command that signs in, lists models (check GPT-6 Luna's slug, expected `gpt-6-luna`), and writes one TL;DR. Confirms a random loopback port is accepted (the guide's examples use 1455; if only fixed ports work, use 1455 with a fallback), that `text.format` JSON schema works on the plan route, and the time per TL;DR.
2. **Article TL;DR finder** in `packages/core` with fixtures (Wikipedia, arXiv, a Reddit post with "TL;DR:", a blog with "Key takeaways", a page with none).
3. **Data:** migration, SQLite, local API route, manifest, tests.
4. **ChatGPT sign-in** in Rust and Settings → ChatGPT.
5. **TL;DR writer and queue**, errors and the limit pause.
6. **The UI:** the gist line in rows, the pane, `w`, `b`, **Write TL;DRs for this group** in every group menu and the select bar, the sidebar's remaining count, the reader box, palette actions; shortcuts registry and `?` help.
7. **Docs and release:** README feature line, `PRIVACY.md` (source text goes to OpenAI only when the user signs in with ChatGPT), `docs/INSTALL.md`, CHANGELOG, `docs/dev/ROADMAP.md`.
8. **Claude:** the gist in `list_sources` and `read_source`.

Steps 2 and 3 can run in parallel with 4. The spike decides whether anything in step 4 changes.

## Risks

- **Preview:** OpenAI calls plan usage for open-source apps a preview; endpoints or rules may change. Everything ChatGPT-specific sits in `src-tauri/src/ai/chatgpt.rs`; OpenRouter and OpenCode already work behind the same `ai_complete` if it breaks.
- **Plan usage:** each TL;DR is roughly 6,000 tokens in and 200 out. Day to day (new saves) that's small; the 800-source backlog is not, hence old sources only in picked groups, the confirmation over 25, and the per-app weekly cap the user can set in ChatGPT Settings → Usage → App limits. On Plus, the five-hour limit is shared with ChatGPT and other apps.
- **Plans:** Plus and Pro can use plan sharing; Free and Go accounts get `subscription_sharing_user_not_eligible`.
- **Quality:** a TL;DR from the outline and first paragraphs can miss a point buried deep in a long article. "Best part" and the key points are judged on what was sent. If the owner finds them thin, send more text for short sources (under 24,000 characters the whole text is sent anyway).

## As built (2026-10-24, branch `tldr`)

Steps 2–7 are built, apart from the docs and release items listed below. Step 1 (the spike) was folded into the build, so the owner's first ChatGPT sign-in is also the first real test of that route. Step 8 (Claude) isn't done. What changed from the plan:

- **Three providers, not one (owner, 2026-10-24):** ChatGPT (Sign in with ChatGPT), **OpenRouter** and **OpenCode** (Zen), each with a model picker; the last two take an API key. Settings → TL;DR picks one. Code: `apps/desktop/src-tauri/src/ai/` (`mod.rs` settings, keys and dispatch; `chatgpt.rs` sign-in, refresh and the Responses stream; `openai_compat.rs` Chat Completions for OpenRouter `https://openrouter.ai/api/v1` and OpenCode `https://opencode.ai/zen/v1`). Keys live in `ai_keys.json`, ChatGPT tokens in `chatgpt_auth.json` and the choice in `ai_settings.json`, all in the app data folder; the webview only sees `AiStatus`. An OpenRouter key is checked with `GET /key` before it's saved; an OpenCode key isn't (there's no such endpoint).
- **Default model:** GPT-6 Luna when the provider lists it; otherwise (OpenRouter, OpenCode) the first free model; otherwise the first in the list. It's saved on first use, so Settings shows it.
- **Plain prompting**, no provider "structured output" switch: `TLDR_INSTRUCTIONS` asks for JSON and `parseTldrAnswer` reads the first JSON object in the answer; an unreadable answer gets one more try.
- **Storage is its own table**, `item_tldrs` (Supabase migration `20261024000000_item_tldrs.sql`, applied 2026-10-24; a SQLite table with the same name in `tldr_store.rs`), so a TL;DR never moves `items.updated_at`. Routes: `GET /api/tldrs?folder=|project=`, `PUT` and `DELETE /api/tldrs/[itemId]` in `packages/client` (with website wrappers). Offline: `list_tldrs`, `put_tldr`, `delete_tldr`.
- **Group menus:** the sidebar's group menu (any group, without opening it) and the group header (**Write TL;DRs**, which turns into "12 left, Stop" while it runs). The sidebar row shows a spinner while its group runs. Ticking subgroup rows to pick several groups was dropped: subgroup rows are buttons, and the sidebar menu already covers every group.
- **Left out for now:** reading time in the pane (it needs the text; the pane shows the source type and its meta line instead), "the text changed since this TL;DR was written" (the hash is stored, but nothing reads it yet), TL;DRs in `.sourcefold` project files, Esc closing the floating pane on narrow windows, and the README, PRIVACY, INSTALL and CHANGELOG updates (they wait for the owner's test).
- **Where things are:** core `packages/core/src/tldr/` (article finder, input builder, prompt, types); desktop `apps/desktop/src/features/tldr/` (`tldr-engine.ts` the queue, `tldr-store.ts` the app's one engine and its hooks, `TldrProvider.tsx` project loading and the confirm dialog, `TldrPane.tsx`, `TldrBox.tsx` in the reader, `TldrSettings.tsx`, `tldr-prefs.ts`). Picked groups and the start time are kept in `localStorage` (`sourcefold:tldr`).
