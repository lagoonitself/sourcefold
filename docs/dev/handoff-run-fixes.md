# Fixes from the owner's 800-source run: build contract

On 2026-10-19 the owner added about 800 sources to project "ai research" through Claude Desktop and the MCP server, and reported what went wrong. This file is what the orchestrator found when it investigated each report, and what each agent builds. Branch `mcp-run-fixes` (off `research-tools`).

Every agent reads this file, `AGENTS.md` and its own package below. Edit only the files your package owns. Don't commit, don't switch branches, don't run `npm run build -w @sourcefold/mcp` (the orchestrator builds once at the end; parallel builds clash on `apps/mcp/dist`). Keep each file's existing line endings (LF). If something here turns out wrong when you try it, stop and report what you saw instead of inventing another design.

## What the investigation found

### 1. "Claude Desktop restarted" (the crash): Node's `fetch` asserts

Claude Desktop's own log (`%LOCALAPPDATA%\Claude\logs\main.log`) shows the MCP server process dying 4 times on 2026-10-19 (20:13, 20:17, 20:17, 20:26) with the same error:

```
[error] Sentry caught: { value: 'MCP Node Host fatal (uncaughtException)' }
[UtilityProcess stderr] [nodeHost] uncaughtException: The expression evaluated to a falsy value:
  assert(!this.paused)
```

`assert(!this.paused)` is in undici's HTTP/1.1 client (`lib/dispatcher/client-h1.js`), the code behind Node's built-in global `fetch`. It fires from a socket event, so no `try/catch` around `fetch` can catch it, and Claude Desktop's Node host turns any uncaught exception into a fatal exit. Every queued add job lived only in that process's memory, so all were lost (reports 1 and 2). The NYT links were what was being fetched: NYT answers this server with a DataDome bot-check page (HTTP 403, `geo.captcha-delivery.com`), the kind of odd response that trips the assert. The article text itself is not the problem: the archived NYT HTML converts in 106 ms and 70 MB.

So: **the MCP must not use Node's global `fetch` for third-party sites.** (Calls to Sourcefold's own web API and the desktop app's local server can keep it.)

### 2. Sites refusing (report 4) are fingerprinting Node, and HTTP/2 gets through

Measured from this computer on 2026-10-19 (homepages; `->` is "current MCP fetch" vs "node:http2 with Chrome's navigation headers"):

| Site                                                                                       | MCP today           | HTTP/2 + Chrome headers                                  |
| ------------------------------------------------------------------------------------------ | ------------------- | -------------------------------------------------------- |
| techspot.com, gamespot.com, axios.com, bostonreview.net, staffingindustry.com, ai.nejm.org | 403                 | **200**                                                  |
| nytimes.com article (the crash link)                                                       | 403 (DataDome)      | **200**                                                  |
| forbes.com, techxplore.com, medicalxpress.com, weforum.org                                 | 200                 | 200 (the article pages likely failed on headers/cookies) |
| decrypt.co, thestreet.com, tesla.com, academic.oup.com, technical.ly, bloomberg.com        | 403                 | 403 (need a real browser: not in this round)             |
| reuters.com                                                                                | 401                 | 401 (same)                                               |
| apa.org                                                                                    | 200 + bot wall page | HTTP/2 not offered: must fall back to HTTP/1.1           |

Adding Chrome's headers to the current HTTP/1.1 fetch changed nothing (same statuses), so it's the HTTP version / connection fingerprint, not the headers alone. Chrome's navigation headers used in the test (`apps/mcp/scratch/h2.mjs`):

```
user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36
accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8
accept-language: en-US,en;q=0.9
accept-encoding: gzip, deflate, br
sec-ch-ua: "Chromium";v="141", "Google Chrome";v="141", "Not?A_Brand";v="99"
sec-ch-ua-mobile: ?0
sec-ch-ua-platform: "Windows"
sec-fetch-dest: document
sec-fetch-mode: navigate
sec-fetch-site: none
sec-fetch-user: ?1
upgrade-insecure-requests: 1
```

### 3. "Couldn't reach that page" (report 5)

- **finance.yahoo.com:** Yahoo answers a browser user agent with about 26 KB of response headers (cookies). Node's fetch fails with `UND_ERR_HEADERS_OVERFLOW` (limit 16 KB), which Sourcefold words as "Couldn't reach". Needs a bigger header limit (256 KB).
- **mitsloanme.com/?p=10975:** the site answers HTTP 500. The message should say so.
- **mp.weixin.qq.com:** the TLS handshake fails from here. The message should say it couldn't make a secure connection.
- Today every network error and every 5xx becomes the same "Couldn't reach that page. Check the link and try again." because `fetchWebPageCapture` replaces any error from the fetch with that message.

### 4. "Couldn't find the article text" on apa.org (report 6)

Both APA pages answer HTTP 200 with an Imperva (Incapsula) bot wall: an 920-byte page whose body is `<iframe id="main-iframe" src="/_Incapsula_Resource?...">Request unsuccessful. Incapsula incident ID: …</iframe>`. It's a refusal, so it must say the site refused, not that there was no article. A saved copy is at `C:\Users\anilr\AppData\Local\Temp\apa.html` (copy it into a test fixture). Separately, the owner asked that a real page where the article extractor finds nothing falls back to the page's main text.

### 5. arXiv pages going to the PDF path (report 3)

The `GlobalWorkerOptions.workerSrc` error itself was fixed on 2026-10-19 (commit `a2e394b`); the owner's installed bundle was older. With today's code all 7 arXiv links save, but by PDF, slowly (92 s for 2308.08708). Why not HTML: `https://arxiv.org/html/2308.08708` answers 200 with the paper, but its LaTeX conversion has no `<h1>` title (the page's `<title>` is "1Indicator Properties"), and `arxivHtmlToCapture` throws "Couldn't read this paper." when there's no `h1.ltx_title_document`/`h1.ltx_title`, so `fetchArxiv` falls back to the PDF. (`/html/2303.07103v3` is a real 404: no HTML version exists, PDF is right there.)

### 6. MCP rough edges (reports 2, 8, 9)

- `No add job 5ea963f7. Jobs are kept until Claude Desktop restarts…`: jobs are only in memory (`apps/mcp/src/tools/add-jobs.ts`).
- `0 of 5 links done` on a job that is queued behind others: `formatJob` says "Waiting for an earlier add job to finish." without how many.
- `move_sources` refuses a source whose link the target group already has (`409 That group already has this link.` from `PATCH /api/items/<id>`).
- `get_source` (and every tool) needs the full 36-character id; a short id gets `Invalid item ID` from the web API.
- `get_project_tree` with `include_sources` at 812 sources returned 129,195 characters.
- `get_status` showed 152 changes not saved to Drive: the web app and desktop app save to Drive by themselves, but when only Claude is working nothing does.

## Packages

Scratch tools (not committed, `apps/mcp/scratch/`, excluded from git): `repro.ts` (fetch + extract one or more links the way add_links does, prints time and memory; `HTML_FILE=<path>` serves that file as the first response), `status.ts` (HTTP status per URL through the MCP's fetch), `h2.mjs` (plain node:http2 GET). Build a `.ts` one with:

```
cd apps/mcp
npx esbuild scratch/repro.ts --bundle --platform=node --format=esm --outfile=scratch/repro.mjs --external:pdfjs-dist --external:'pdfjs-dist/*' --external:@napi-rs/canvas --external:canvas --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" --log-level=warning
node scratch/repro.mjs https://example.com/article
```

### Package A: MCP network transport (fixes the crash, reports 1, 4, 5)

Owns: `apps/mcp/src/links/node-transport.ts` (new), `apps/mcp/src/links/public-fetch.ts`, `apps/mcp/src/tools/images.ts` (only its download of a third-party image), `apps/mcp/src/main.ts`, new tests `apps/mcp/src/__tests__/node-transport.test.ts` and `public-fetch.test.ts` (or extend an existing test file that only you touch).

1. **`node-transport.ts`: `export const nodeFetch: typeof fetch`**, a WHATWG-`fetch`-shaped function built on `node:tls`, `node:http2`, `node:https`, `node:http` and `node:zlib`, never on the global `fetch`/undici.
   - Input: `(input: string | URL | Request, init?: RequestInit)`. Support `method`, `headers` (a `Headers`, a plain object or an array of pairs), `body` (string, `Uint8Array`/`ArrayBuffer`, `URLSearchParams`, or undefined) and `signal`. It **never follows redirects**: it returns 3xx responses as they are (`createPublicFetch` follows them hop by hop and checks each address).
   - `https:` URLs: open `tls.connect({ host, port: port || 443, servername: host, ALPNProtocols: ["h2", "http/1.1"] })`. On `secureConnect`, if `socket.alpnProtocol === "h2"`, use `http2.connect(origin, { createConnection: () => socket, maxSessionMemory: 64 })` and `session.request({ ":method", ":path": pathname + search, ":authority": host, ...headers })`; otherwise send HTTP/1.1 over that same socket with `https.request({ ..., createConnection: () => socket, agent: false, maxHeaderSize: 262144 })`. If the HTTP/2 session or stream fails with an `ERR_HTTP2_*` error before any response arrived, retry once over HTTP/1.1 on a new socket (`ALPNProtocols: ["http/1.1"]`). `http:` URLs: `http.request` with `maxHeaderSize: 262144`.
   - HTTP/2 rules: header names lowercase; drop `connection`, `keep-alive`, `proxy-connection`, `transfer-encoding`, `upgrade` and `host` (HTTP/2 refuses them); pass a larger header limit (`settings: { maxHeaderListSize: 262144 }` on connect) so Yahoo's 26 KB of cookies fit.
   - Response: `new Response(body, { status, headers })` with `body = Readable.toWeb(stream)` (null for `HEAD`, 204, 205, 304). Decompress by `content-encoding`: `gzip`/`x-gzip` → `zlib.createGunzip()`, `deflate` → `zlib.createInflate()`, `br` → `zlib.createBrotliDecompress()`, then remove `content-encoding` and `content-length` from the headers you hand back. Skip HTTP/2 pseudo-headers (`:status` etc.) except to read the status. Keep repeated `set-cookie` values (use `headers.append`). Set `url` on the response with `Object.defineProperty(res, "url", { value: href })`.
   - Timeouts: 20 s to connect (TCP + TLS), then 30 s of no data on the socket → fail with an `Error` whose `code` is `"ETIMEDOUT"`. `signal` aborted → destroy the socket/stream and reject with `signal.reason` (or `new DOMException("This operation was aborted", "AbortError")`).
   - **No error may escape as an uncaught exception.** Attach an `error` listener to every socket, TLS socket, HTTP/2 session, HTTP/2 stream, `ClientRequest`, `IncomingMessage` and zlib stream you create, before anything can emit. Errors reject the returned promise (before the response) or error the body stream (after). Close the HTTP/2 session when the body ends, errors or is cancelled. Keep the original `code` on errors (`ENOTFOUND`, `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `ERR_TLS_*`, `CERT_*`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `ERR_SSL_*`, `EPROTO`).
2. **`public-fetch.ts`:**
   - `createPublicFetch`'s default `fetchImpl` becomes `nodeFetch` (keep `deps.fetch` for tests).
   - Cookie jar per call: on each redirect hop, read every `set-cookie` of the 3xx response (`res.headers.getSetCookie()`), keep `name=value` with its `Domain` (default: that hop's host) and send matching cookies as a `cookie` header on later hops (a cookie matches when the next host equals its domain or ends with `.` + domain). This is for consent redirects that set a cookie and bounce back. Don't keep cookies between calls.
   - `createNodeSourceFetch`: default headers become the full Chrome navigation set above (each only when the request didn't set it; a request's own `accept` wins). Its `catch` maps errors to clear `SourceError("fetch_failed", …)` messages instead of one generic line:
     - `ENOTFOUND`/`EAI_AGAIN`/the `Couldn't look up` TypeError: "Couldn't find the site's address (DNS lookup failed). Check the link."
     - `ECONNREFUSED`: "The site refused the connection."
     - `ECONNRESET`/`EPIPE`: "The site closed the connection before answering."
     - `ETIMEDOUT`: "The site didn't answer in time."
     - TLS/certificate codes above: "Couldn't make a secure connection to the site (its certificate or encryption was refused)."
     - `Too many redirects`: "The site kept redirecting, so the page never loaded."
     - anything else: keep "Couldn't reach the site. Check your connection and try again."
       Keep the `BlockedAddressError` → `SourceError("blocked", …)` mapping and rethrow `AbortError`/`TimeoutError` untouched.
3. **`images.ts`:** the download of an image from a third-party URL (around line 73, `res = await fetch(parsed, …)`) goes through `createPublicFetch()` (redirect-following, address-checked, `nodeFetch`). Leave the upload to the signed Supabase URL (`put = await fetch(signed.signed_url, …)`) on the global fetch.
4. **`main.ts`:** add `process.on("unhandledRejection", (err) => console.error("[sourcefold] unhandled rejection:", err))` so a stray rejected promise is logged instead of becoming a fatal uncaught exception. Don't add an `uncaughtException` handler.
5. **Tests** (vitest, `apps/mcp`): start a local `http.createServer` on `127.0.0.1` and call `nodeFetch` directly (not through `createPublicFetch`, which refuses local addresses): status and headers; a gzip and a br body come back decompressed; a 40 KB `set-cookie` header works; a 302 is returned, not followed; an aborted signal rejects with `AbortError`; a server that never answers trips the timeout (make the timeouts injectable, e.g. `createNodeFetch({ connectTimeoutMs, idleTimeoutMs })` with `nodeFetch = createNodeFetch()`); a closed port rejects with `code: "ECONNREFUSED"`; a socket destroyed mid-body errors the body stream and nothing is uncaught (listen for `process.on("uncaughtException")` in the test and assert it never fired). For the cookie jar, inject `deps.fetch` and `deps.lookup` into `createPublicFetch` and check the second hop gets the cookie. For the error messages, inject a fetch that rejects with each code.
6. **Live check** (report the output): rebuild and run `node scratch/status.mjs` with the URLs in the table above, plus `https://finance.yahoo.com/news/` and `https://www.apa.org/`, and `node scratch/repro.mjs https://www.nytimes.com/2025/08/08/technology/ai-chatbots-delusions-chatgpt.html https://www.techspot.com/ https://arxiv.org/abs/2308.08708`. Expect the "**200**" rows above to answer 200 now, Yahoo to answer (no "Couldn't reach"), and the process to stay alive throughout.

### Package B: core extraction (reports 3, 5, 6)

Owns: `packages/core/src/web-page/**`, `packages/core/src/pdf/fetch.ts`, `packages/core/src/pdf/arxiv.ts` and their tests and fixtures. These run on the web server, the desktop app and the MCP alike. Keep every existing message string that tests or other code match on; add new ones.

1. **Keep a `SourceError` thrown by the fetch.** In `web-page/fetch.ts` `fetchWebPageCapture`, the `catch` around `options.fetch(...)` must rethrow `error` unchanged when `error instanceof SourceError` (as `pdf/fetch.ts` `send` already does), and only wrap other errors in the generic `fetch_failed`.
2. **Say what the status was.** In `throwIfBadStatus` (web-page) and `ensureOk` (pdf): 404/410 and 401/403/407/429 stay as they are. 500–599 → `SourceError("fetch_failed", \`The site answered with an error (HTTP ${status}). It may be down; try again later.\`)`. Any other non-2xx (e.g. 400, 451) → `SourceError("fetch_failed", \`The site answered HTTP ${status} instead of the page.\`)`.
3. **Bot walls are refusals.** New `web-page/bot-wall.ts` exporting `isBotWall(html: string): boolean`. True when the HTML (only check the first 200,000 characters) contains a strong marker: `_Incapsula_Resource` or `Incapsula incident ID` (Imperva); `captcha-delivery.com` (DataDome); `/cdn-cgi/challenge-platform/` or `cf_chl_` or `cf-browser-verification` (Cloudflare); `px-captcha` or `_pxCaptcha` (PerimeterX/HUMAN); `awswaf` together with `challenge` (AWS WAF); `sucuri_cloudproxy` (Sucuri); or a `<title>` that is exactly `Just a moment...` / `Attention Required! | Cloudflare` / `Access Denied` / `Pardon Our Interruption`. In `fetchWebPageCapture`, after the status check and the PDF check, a 200 response that `isBotWall` → `SourceError("blocked", MESSAGES.blocked)`. Fixtures: copy `C:\Users\anilr\AppData\Local\Temp\apa.html` (Imperva) and `C:\Users\anilr\AppData\Local\Temp\nyt.html` (DataDome) into `web-page/fixtures/`; add a test that a long real article fixture (one already in `web-page/fixtures/`) is not a bot wall.
4. **Fallback to the page's main text.** In `web-page/convert.ts`, when defuddle's result is under `MIN_WEB_PAGE_TEXT_LENGTH`, try once more on a fresh parse of the same HTML: remove `script, style, noscript, template, nav, header, footer, aside, form, iframe, svg, button, [role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true]`, take the first of `main`, `[role=main]`, `article`, `#content`, `#main`, `.content`, `body`, convert it with the same HTML-to-Markdown step convert.ts already uses, and use it when its `webPageTextLength` reaches the minimum (title, site and meta as defuddle found them). Export it as `fallbackMainText(doc, url)` or similar so it's testable. Add a fixture where defuddle finds too little (build one: check in the test that defuddle alone is under the minimum) and the fallback succeeds. A bot wall never reaches this (step 3 runs first).
5. **arXiv HTML without a title.** `arxivHtmlToCapture` returns the capture with `title: ""` instead of throwing when the `h1` title is missing (it still throws when there's no article). In `fetchArxiv` (`pdf/fetch.ts`), after an HTML capture, call `readArxivMetadata(arxiv.id, options)`: use its title when present (arXiv's API title is the authoritative one), fill `meta.author` when the HTML had none, and `meta.published` from it. If the title is still empty, fall back to the PDF as today. Fixture: download `https://arxiv.org/html/2308.08708` and cut it down to under 150 KB (keep the `<article class="ltx_document">` start, the abstract and two sections, close the tags), plus an Atom answer for `id_list=2308.08708` (title "Consciousness in Artificial Intelligence: Insights from the Science of Consciousness"); test that the capture comes from HTML (`kind: "pdf"`, markdown from the sections, no PDF request made) with that title. Update any existing test that expected the old throw.
6. Run `npm test -w @sourcefold/core`, `npm run typecheck -w @sourcefold/core`, and also `npm test -w @sourcefold/web` and `npx vitest run` in `apps/desktop` (they use these extractors; all must pass). Then the live check: rebuild `apps/mcp/scratch/repro.mjs` and run it on `https://arxiv.org/abs/2308.08708` (expect a fast HTML save, not 90 s), `https://www.apa.org/topics/artificial-intelligence-machine-learning/health-advisory-chatbots-wellness-apps` (expect the "site refused" message) and `https://mitsloanme.com/?p=10975` (expect the HTTP 500 message).

### Package C: MCP add jobs and Drive autosave (reports 2, 7, 8 queue, 9)

Owns: `apps/mcp/src/tools/add-jobs.ts`, `apps/mcp/src/tools/add.ts`, `apps/mcp/src/tools/drive.ts`, `apps/mcp/src/tools/drive-autosave.ts` (a stub exists; keep its exported signature `scheduleDriveSave(api: WebApi): void` exactly, package D calls it), `apps/mcp/src/__tests__/add.test.ts`, `drive.test.ts`, new `add-jobs-store.test.ts`/`drive-autosave.test.ts`.

1. **Jobs survive a restart.** Save the jobs to `join(appDataDir(), "mcp-add-jobs.json")` (`appDataDir` from `../config`). Put the file access behind a small interface passed to `AddJobs` (e.g. `store: { load(): AddJob[]; save(jobs: AddJob[]): void }`, with `fileJobStore(path)` as the real one and an in-memory one in tests). Save after every change to a job or row (debounced to at most once a second, plus immediately when a job starts and ends). Write atomically: write `<file>.tmp`, then rename over the file. A missing or unreadable file means no jobs; never throw from load or save (log with `console.error("[sourcefold] …")`).
   On start (`registerAddTools` creates `AddJobs`; call its `restore()` there), load the file: keep up to `KEEP_JOBS` jobs; for each job that was `queued` or `running`, set rows that were `saving`, `finding` or `paused` back to `waiting` (clear `resumeAt` and `message`), set the job to `queued` and queue it again, oldest first, through the same `tail` chain `start()` uses. Finished and stopped jobs come back as they were, so `get_add_progress` still answers for them.
   Change the not-found message in add.ts to: `No add job <id>. Only the last 20 jobs are kept; call get_add_progress without a job_id to list them.` and remove "until Claude Desktop restarts" from every message and tool description in add.ts and add-jobs.ts comments.
2. **Queue position.** `AddJobs.ahead(job)` returns the jobs queued or running before it (by `createdAt`). For a `queued` job, `formatJob` says `Waiting behind N earlier add job(s) with M links still to save.` instead of "Waiting for an earlier add job to finish." (pass what it needs as an argument so `formatJob` stays a pure function).
3. **A time limit per link.** `saveWithRetries` passes `AbortSignal.timeout(linkTimeoutMs)` (2 minutes; injectable through `Pacing` for tests) as `saveLink`'s `signal` argument (the 5th one, `undefined` today). If the link fails because that signal fired (and the job wasn't stopped), the row fails with "The site took too long to answer (over 2 minutes)." The YouTube rate-limit waits are outside that limit (start a new signal for each attempt).
4. **Paid Substack posts.** When a job has rows with status `paid`, `formatJob` adds one line after the counts: `Paid posts need the user's Substack cookie: in the Sourcefold desktop app, Settings → Substack. Then add those links again.`
5. **Drive autosave** (`drive-autosave.ts`). Move the batch loop out of `save_to_drive` into a shared exported function (e.g. `saveToDrive(api, { budgetMs })` in `drive.ts` returning `{ processed, remaining, done, failed, waited }`), so the tool and the autosave run the same code; the tool's replies stay exactly as they are (existing drive tests must pass unchanged). `scheduleDriveSave(api)` (re)starts a 2-minute timer (`.unref()` it); when it fires, run `saveToDrive` with a 5-minute budget in the background, one run at a time (a call during a run schedules another run after it). Skip quietly when `/drive/status` says `connected: false`, when the app answers `sync_in_progress` (the app is already saving), or on any error (log one line with `console.error("[sourcefold] drive autosave: …")`). Never throws, never rejects unhandled. `AddJobs` calls an `onJobFinished` callback given to its constructor; `add.ts` wires it to `scheduleDriveSave(ctx.api)`. Tests with vitest fake timers and a fake `api`.
6. Run `npm test -w @sourcefold/mcp` (all tests, report counts) and `npm run typecheck -w @sourcefold/mcp`.

### Package D: MCP tool edges (report 8)

Owns: `apps/mcp/src/tools/define.ts`, `apps/mcp/src/tools/short-ids.ts` (new), `apps/mcp/src/tools/library.ts`, `apps/mcp/src/tools/organize.ts`, `apps/mcp/src/__tests__/library.test.ts`, `organize.test.ts`, `foundation.test.ts`, new `short-ids.test.ts`. Read `apps/mcp/src/__tests__/harness.ts` first; tests use it.

1. **Short ids.** `short-ids.ts`:
   - `rememberIds(text: string): void` adds every UUID in the text (`/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi`, lowercased) to a module-level set (cap 50,000; drop the oldest beyond that). Also export `rememberId(id)`.
   - `resolveId(input: string): string`: trim; a full UUID is returned as is (lowercased); 6 or more hex characters (optionally with dashes, as long as it's a prefix of the UUID form) → the remembered ids that start with it: exactly one → that id; none → throw `No source or group id starting "<input>" has been shown yet. Use the full id from list_sources or get_project_tree.`; several → throw `"<input>" matches <n> ids. Use more characters or the full id.`; anything else is returned unchanged (the web API checks it).
   - `define.ts`: after a tool's `run` succeeds, `rememberIds(text)`. Before `run`, resolve top-level arguments named `source_id`, `source_ids`, `group_id`, `parent_id`, `project_id`, `keep_id`, `ids`, `highlight_id`, `card_id` (strings, or arrays of strings) with `resolveId`; a resolution error is answered like other errors (`isError: true`). Don't touch other arguments (`project` takes names).
   - Also in `define.ts`: after a successful run of a tool that isn't `readOnly`, call `scheduleDriveSave(ctx.api)` from `./drive-autosave` (package C implements it; the stub does nothing).
2. **`get_project_tree` stays small.** New inputs: `group_id` (optional: show only that group and the groups under it) and `compact` (boolean, default false). With `include_sources`, compact is turned on by itself when the shown part has more than 300 sources. A compact source line is `  [<first 8 characters of the id>] <title, cut to 90 characters>` (no kind, author, date or url); call `rememberId` with each full id so the short ids resolve later. A header line explains: `Short ids: the first 8 characters of each id; any tool accepts them.` Hard cap: stop adding source lines once the output reaches 60,000 characters, and end with `…<n> more sources not shown. Call get_project_tree with group_id set to one of these groups: <id> <name>, …` listing the groups whose sources were cut. Update the tool description.
3. **`move_sources` can finish a reorganization.** New input `if_duplicate`: `"fail"` (default, today's behaviour), `"skip"`, or `"merge"`. When `PATCH /api/items/<id>` answers 409 with "already has this link" (an `ApiError` with status 409 from `../web-api`): `skip` lists the source under `Skipped (the group already has this link):`; `merge` finds the copy already in the target group with `POST /items/check { url, folder_id: group_id }` (the answer's `item_id`; `url` is the source's `canonical_url` or `source_url`, from `GET /items/<id>` if `loadSourceRef` doesn't have it) and calls `POST /items/<that item_id>/merge { ids: [<the moved source's id>] }` (it moves highlights, cards, tags and notes into the copy that stays and deletes the moved one), listing it under `Merged into the copy already in the group:` with both ids. Update the description so the model knows when to use each.
4. Tests for each of the above with the harness's fake API. Then `npm test -w @sourcefold/mcp` (all, report counts) and `npm run typecheck -w @sourcefold/mcp`.

## After the packages (orchestrator)

Review each diff against `HEAD`, run every suite, build the bundle, update `docs/dev/handoff-mcp.md` (tool table: `move_sources if_duplicate`, `get_project_tree compact/group_id`, short ids, jobs surviving restarts, Drive autosave), `HANDOFF.md` and `ROADMAP.md`, and commit. Not in this round: a real-browser fallback (the desktop app's webview or the Chrome extension) for the sites that still refuse (Decrypt, TheStreet, Tesla, OUP, Technical.ly, Bloomberg, Reuters).
