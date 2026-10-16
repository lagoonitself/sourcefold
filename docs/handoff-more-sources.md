# Handoff: more source types (2026-10-16, done; kept for the decisions)

**Status:** built, checked and committed on 2026-10-16. What's left is the owner's test and applying the migration; see `HANDOFF.md`. The rest of this file is the plan as it was written, kept because it records the decisions (file format, agent split).

Read this together with `HANDOFF.md`. It picks up the "more source types" work in the middle. Nothing here is committed yet. `main` is at `a0f8c7a` (committed, not pushed).

## The owner's request (2026-10-16)

Add more source types. **YouTube transcripts matter most.** The owner pastes a YouTube link and Sourcefold saves the transcript. It must be **free**: no paid APIs and no API keys the owner has to buy. For every source, **use the best existing open-source project** instead of researching or writing from scratch, the way Substack support ported sbstck-dl (`packages/core/src/substack/`). Credit each one in `docs/open-source-references.md` and check its license is MIT/Apache/BSD (this repo is MIT).

Order:

1. **YouTube transcripts (priority).** Use the method of `jdepoix/youtube-transcript-api` (MIT):
   - Fetch `https://www.youtube.com/watch?v=<id>`. If YouTube shows a consent page, send the cookie `CONSENT=YES+…`.
   - Read `"INNERTUBE_API_KEY":"…"` from the page, then POST `https://www.youtube.com/youtubei/v1/player?key=<key>` with `{"context":{"client":{"clientName":"ANDROID","clientVersion":"20.10.38"}},"videoId":"<id>"}`.
   - Check `playabilityStatus`. Caption tracks are at `captions.playerCaptionsTracklistRenderer.captionTracks[]` (`baseUrl`, `languageCode`, `name`, `kind: "asr"` means auto-generated). Take `&fmt=srv3` out of `baseUrl` and fetch the timedtext XML (`<text start dur>`; also handle the srv3 form `<p t d>`). Unescape entities and strip tags.
   - Choose a track: a manual track in the video's language (the asr track's language), then the auto-generated one, then any manual track.
   - Metadata comes from `videoDetails` (title, author = channel, channelId, lengthSeconds, shortDescription) and `microformat.playerMicroformatRenderer.publishDate` from the watch page's `ytInitialPlayerResponse`.
   - Accepted links: `watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `m.youtube.com`, with timestamps stripped.
   - YouTube blocks cloud servers (Vercel), so fetching happens **in the desktop app** (Rust HTTP like `apps/desktop/src-tauri/src/substack.rs`, extraction in the webview like `features/substack/substack-client.ts`) and in the **Chrome extension** (the user's own connection, same-origin fetch from the content script on youtube.com). Both save through `POST /api/capture` like Substack. A YouTube link pasted into the web app's Add links should say to use the desktop app or the extension.
   - Saved Markdown: front matter gives title, channel, published date, duration, language and whether the captions are auto-generated. The body is the transcript in readable paragraphs; each paragraph starts with a `[mm:ss](https://youtu.be/<id>?t=<s>)` link (`h:mm:ss` past an hour). The video description goes under its own heading.
   - A video with no captions saves an `unavailable` item with the reason "No captions on this video", like Substack's "Paid post, not saved". Don't build local Whisper now.
   - Optional, after single videos work: a playlist or channel link lists its videos the way Substack publications do.
2. **Any web page.** Use `kepano/defuddle` (MIT, the Obsidian Web Clipper extractor) for the main content, then the existing Turndown setup for Markdown. Keep images like Substack: `![alt](url)` with an italic caption below. This also covers news sites, blogs, Britannica, and free Medium, Ghost and beehiiv posts. It saves from the web app (server fetch), the desktop and the extension; the extension already captures the current page and should use defuddle on pages that aren't Substack or X.
3. **Reddit threads.** Use Reddit's public `.json` for a post: the post, then the top comments as nested blockquotes with scores and authors, like X threads. No library needed. Reddit often blocks cloud IPs; on a 403 from the server, say to use the desktop app or the extension.
4. **PDFs and papers.** `pdfjs-dist` (Mozilla pdf.js, Apache-2.0) gets the text from any PDF link. For arXiv links, use arXiv's own HTML version when there is one, otherwise the PDF.
5. **Hacker News threads** (official Algolia API `https://hn.algolia.com/api/v1/items/<id>`) and **Bluesky posts and threads** (public `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread`, no login; resolve a handle with `com.atproto.identity.resolveHandle` if needed).

How to work:

- **Model for subagents (owner's choice, 2026-10-16): DeepSeek V4.1 Flash Free on OpenCode.** Use T3 `delegate_task` with `target: { providerInstanceId: "opencode", model: "opencode/deepseek-v4.1-flash-free" }`, `mode: "async"` and `isolation: "shared"`. Not Sonnet.
- Give each agent strict file ownership, and paste the relevant rules from `AGENTS.md` into every brief (no git commands, only its own files, run lint/typecheck/test).
- Review every change against HEAD for deleted functions or tests before accepting it (`git diff --stat`, then read the removals). This has bitten us twice.
- Then run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `cargo test` in `apps/desktop/src-tauri`.
- Don't apply migrations to the owner's Supabase and don't push without asking. Don't launch the app; finish with manual test steps for the owner. Update `HANDOFF.md` and `docs/ROADMAP.md`, then commit.

Still open from the previous thread (ask the owner):

- Apply `supabase/migrations/20261015000000_wikipedia_kind.sql` before deploying, or Wikipedia saves fail.
- After deploying, optionally set `drive_synced_at = null` on live saved items so the next Save to Drive builds Google Docs and image folders for older sources.

## Done so far (uncommitted, in the working tree)

1. **`packages/core/src/capture-types.ts`** adds the shared contract:
   - `SOURCE_CAPTURE_KINDS = ["youtube","web","reddit","pdf","hackernews","bluesky"]`, `SourceCaptureKind` and `isSourceCaptureKind()`.
   - `SourceCapture { url; title; meta: Record<string, string|number|null>; markdown }`. `meta` keys are exactly the front matter field names below; `markdown` is the body only.
   - `SourceExtractResult` is `{status:"ok",kind,capture}` or `{status:"unavailable",kind,url,title,reason}`.
   - `CaptureRequest` gains `{ kind: SourceCaptureKind; folder_id; capture: SourceCapture }` and `{ kind: "source_unavailable"; folder_id; source: SourceCaptureKind; url; title; reason }`.
2. **`packages/core/src/source-fetch.ts`** (new): the network interface for every new extractor.
   - `SourceFetchRequest {url, method?, headers?, body?, responseType?: "text"|"bytes", signal?}` and `SourceFetchResponse {status, url (final), headers (lowercase), text, bytes?}`. `SourceFetch` is a function from request to response.
   - `SourceError(code, message)` with codes `invalid_url | not_found | blocked | fetch_failed | parse_failed | too_large`. The message is shown to the user as is (follow DESIGN.md's writing rules).
   - `sourceFetchFromGlobalFetch(fetchImpl?, defaultHeaders?)` is for the server.
   - Extractors never call the global fetch, so tests use saved fixtures.
3. **`packages/core/src/source-links.ts`** (new):
   - `parseYouTubeLink`: video, playlist or channel, with canonical `https://www.youtube.com/watch?v=<id>`.
   - `youTubeVideoUrl` and `youTubeTimestampUrl(id, s)`, which gives `https://youtu.be/<id>?t=<s>`.
   - `parseRedditLink`: a post (canonical `https://www.reddit.com/r/<sub lowercase>/comments/<id>`, or `/comments/<id>` with no sub) or a `share` link (`/r/x/s/code`, which needs its redirect followed). Also `redditPostUrl`.
   - `parseHackerNewsLink` and `hackerNewsItemUrl`.
   - `parseBlueskyLink` (`{actor, rkey, url}`; handles lowercased, DIDs kept) and `blueskyPostUrl`.
   - `parseArxivLink` (`{id, version, url: https://arxiv.org/abs/<id>}`, new and old ids) and `looksLikePdfUrl`.
   - `detectLinkKind(url)` returns `youtube|reddit|hackernews|bluesky|pdf|web` or null. Callers check Grokipedia, Wikipedia, Substack and X first.
   - `canonicalSourceUrl` and `meaningfulQuery(url)`: drops `utm_*` and tracking parameters (`fbclid gclid dclid gbraid wbraid msclkid yclid mc_cid mc_eid igshid si smid _hsenc _hsmi mkt_tok ref ref_src ref_url`) and keeps the rest in order.
4. **`packages/core/src/url.ts`**: `canonicalizeUrl`, after the Wikipedia rule, now returns `canonicalSourceUrl()` for the new kinds. For any other page it **keeps the meaningful query** (before, it dropped every query, so `page.php?id=5` and `?id=6` collided), except Substack posts (`*.substack.com` or a `/p/<slug>` path), which drop the query entirely. `detectSource` is unchanged.
5. **`delegate-to-subagents` memory** updated with the new model choice.

**Known broken right now:** `packages/core/src/url.test.ts`, test "drops query strings and hashes" (around line 42), still expects the old rule. Replace it with tests for the new rule. Expected results:

- `https://example.com/page?ref=feed&sort=top#section-2` → `https://example.com/page?sort=top`
- `https://example.com/article.php?id=5&utm_source=x&UTM_MEDIUM=y&fbclid=z` → `https://example.com/article.php?id=5`
- `https://name.substack.com/p/a-post?r=abc` → `https://name.substack.com/p/a-post`
- `https://www.noahpinion.blog/p/a-post?r=abc` → `https://noahpinion.blog/p/a-post`
- `https://youtu.be/dQw4w9WgXcQ?t=42`, `m.youtube.com/watch?v=…&t=1m2s`, `/shorts/…`, `/live/…`, `watch?v=…&list=PL…` → `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
- `https://old.reddit.com/r/Cars/comments/1abc2d/some_title/` → `https://www.reddit.com/r/cars/comments/1abc2d`
- `https://news.ycombinator.com/item?id=41234567&p=2` → `https://news.ycombinator.com/item?id=41234567`
- `https://bsky.app/profile/Jay.bsky.team/post/3l6oveex3ii2l` → `…/profile/jay.bsky.team/post/3l6oveex3ii2l`
- `https://arxiv.org/pdf/2401.01234v2.pdf` → `https://arxiv.org/abs/2401.01234`

Also still to write: **`packages/core/src/source-links.test.ts`**, covering every parser above plus `detectLinkKind` (Britannica → `web`, `ftp://` → null). Then run `npx vitest run` and `npx tsc --noEmit` in `packages/core`. Nothing is exported from `packages/core/src/index.ts` yet: add `export * from "./source-links"`, the `source-fetch` exports and the new capture types (`SOURCE_CAPTURE_KINDS`, `isSourceCaptureKind`, `SourceCapture`, `SourceCaptureKind`, `SourceExtractResult`, `SourceMetaValue`). `isSourceCaptureKind` and `SOURCE_CAPTURE_KINDS` are values, so export them separately from the type-only block.

## Contract still to write into `docs/FILE-FORMAT.md` (decided, not yet in the doc)

Kinds stored in `items.kind`: `youtube`, `web`, `reddit`, `pdf` (PDFs and arXiv), `hackernews`, `bluesky`.

Front matter is always `source, title, url, <kind fields in this order>, saved, folder`. A field with no value is left out. Numbers are unquoted, dates are `YYYY-MM-DD`, and strings use the existing YAML quoting.

| Kind        | Kind fields, in order                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube     | `channel`, `channel_url`, `published` (date), `duration` (`M:SS` or `H:MM:SS`), `language` (code), `captions` (`manual` or `auto-generated`) |
| Web page    | `site`, `author`, `published` (date), `summary` (the page description)                                                                       |
| Reddit      | `subreddit` (no `r/`), `author` (no `u/`), `posted` (date), `score` (number), `comments` (number)                                            |
| PDF         | `author`, `published` (date), `pages` (number), `arxiv` (id, arXiv only)                                                                     |
| Hacker News | `author`, `posted` (date), `points` (number), `comments` (number), `link` (the story's own URL)                                              |
| Bluesky     | `author` (display name), `author_url`, `posted` (date)                                                                                       |

Source lines:

- YouTube: `> Saved from [YouTube](<url>) on <saved>.` then ` By <channel>.`, ` Published <published>.`, and ` Transcript from auto-generated captions.` when the captions are auto-generated.
- Web page: `> Saved from [<site, or the host without www.>](<url>) on <saved>.` then ` By <author>.` and ` Published <published>.`
- Reddit: `> Saved from [r/<subreddit>](<url>) on <saved>.` (`[Reddit]` if there's no subreddit).
- PDF: `> Saved from [arXiv](<url>) on <saved>.` when `arxiv` is set, else `[<host without www.>]`. Then ` By <author>.` and ` Published <published>.`
- Hacker News: `> Saved from [Hacker News](<url>) on <saved>.`
- Bluesky: `> Saved from [Bluesky](<url>) on <saved>.`

Bodies:

- **YouTube:** `## Transcript` comes first. Each paragraph starts with `[m:ss](https://youtu.be/<id>?t=<s>) ` and runs about 45–90 s: break at the end of a sentence after about 45 s, and always by 90 s, which matters because auto captions have no punctuation. `## Description` follows with the description, blank lines kept as paragraph breaks.
- **Web page:** the defuddle content through Turndown, with headings starting at `##`. Images are `![alt](absolute url)` with an italic caption paragraph below. No raw HTML.
- **Reddit:** the post's selftext (already Markdown) or a link line for link posts, with images as `![](url)`. Then `## Comments`, one block per comment: `**u/<author>** · <score> points · <date> · [link](<permalink>)` and the text, with replies as nested `>` blockquotes. Take the top comments by score, depth ≤ 4, about 200 comments at most; skip deleted or removed ones that have no replies.
- **Hacker News:** the story's URL as a link line and its text, then `## Comments` in the same style: `**<author>** · <date> · [link](https://news.ycombinator.com/item?id=<id>)`.
- **Bluesky:** like X. The root post and the author's own replies come in sequence; other replies are nested blockquotes. Each post starts `**<name>** (@<handle>) · <date> · [link](<post url>)`. Images are `![alt](fullsize)`; quoted posts and link cards become links.
- **PDF:** text joined into paragraphs, with hyphenated line breaks mended and repeated page headers and footers and bare page numbers dropped where that's easy. arXiv from HTML: `## Abstract`, then the sections, with math as `$…$` taken from `<math alttext>`.

List marks for DESIGN.md, desktop `features/items/source-kinds.tsx` and web `features/items/item-row.tsx` plus the CSS tokens. Color and icon are paired, never color alone:

| Kind       | Name        | Light     | Dark      | lucide icon      |
| ---------- | ----------- | --------- | --------- | ---------------- |
| youtube    | YouTube     | `#B4235A` | `#F08AB0` | `MonitorPlay`    |
| web        | Web page    | `#4D5B6B` | `#B4BFCC` | `Globe`          |
| reddit     | Reddit      | `#A33B12` | `#F59E7A` | `MessagesSquare` |
| pdf        | PDF         | `#7A4B2A` | `#D8A887` | `FileText`       |
| hackernews | Hacker News | `#5F6B0E` | `#C5D16A` | `ChevronsUp`     |
| bluesky    | Bluesky     | `#1D5FD1` | `#8DB4F7` | `Cloud`          |

## Planned agent split

### Wave 1, in parallel, after the contract above is in FILE-FORMAT.md and core exports

1. **core-youtube** owns `packages/core/src/youtube/**`.
   - `fetchYouTubeCapture(url, { fetch: SourceFetch, parseHtml? }) → SourceExtractResult` (no captions → `unavailable`, reason "No captions on this video").
   - Helpers for track choice, timedtext parsing (both XML forms), paragraphs and Markdown.
   - `listYouTubeVideos(url, fetch)` for playlists and channels (from `ytInitialData`, with continuations through InnerTube `browse`).
   - Fixtures saved from real pages; credit youtube-transcript-api.
2. **core-web** owns `packages/core/src/web-page/**` and adds the `defuddle` dependency to `packages/core`.
   - `webPageToCapture(html, url, parseHtml)` and `fetchWebPageCapture(url, {fetch, parseHtml})`.
   - It must work with linkedom on the server and DOMParser in the browser; if defuddle won't run on linkedom, report it rather than adding jsdom silently.
   - A response with a PDF content type throws or flags it so the dispatcher can hand it to the PDF extractor.
3. **core-social** owns `packages/core/src/reddit/**`, `hackernews/**` and `bluesky/**`: `fetchRedditCapture`, `fetchHackerNewsCapture` and `fetchBlueskyCapture`, all `(url, {fetch}) → SourceExtractResult`, each with fixtures.
4. **core-pdf** owns `packages/core/src/pdf/**` and adds `pdfjs-dist`. `pdfToCapture(bytes, url)`, plus `fetchPdfCapture(url, {fetch, parseHtml})`, which tries arXiv HTML first and falls back to the PDF. Use the legacy build in Node; let the app pass the worker setup.
5. **plumbing** owns:
   - `packages/core/src/drive-file.ts` and its test: front matter and source line for the six kinds, driven by a per-kind field table.
   - New goldens in `packages/core/test/golden/` (one per kind, plus README).
   - `apps/desktop/src-tauri/src/service.rs`: `build_item_file` for the new kinds (generic extras from meta), `item_file_fields` reading the same meta on rename, `canonicalize_url` mirroring the TS rules above with tests, the `CapturePayload` variants for the six kinds and `source_unavailable`, `save_source` and `save_source_unavailable`, and a golden test for each new file.
   - Dispatch for the new variants in `commands/items.rs`, `native_host.rs` and `server.rs`. Don't touch the security tests in `server.rs`.
   - `supabase/migrations/20261016000000_more_source_kinds.sql`: widen `items_kind_check` to add the six kinds and add them to the clear-markdown list in `mark_item_stored_in_drive`. Copy `20261015000000_wikipedia_kind.sql`.
   - `apps/web/src/app/api/capture/route.ts` and its test (zod schema for the generic capture and `source_unavailable`), and a new `apps/web/src/features/capture/save-source.ts` (a generic saver: duplicate check, insert with meta and markdown, and the unavailable item with `status: "unavailable"` and `error: reason`).
6. **desktop-fetch** owns new `apps/desktop/src-tauri/src/web_fetch.rs`, `commands/web_fetch.rs`, the registration in `main.rs` and `commands/mod.rs`, and `apps/desktop/src/lib/web-fetch.ts`.
   - A `web_fetch` command: GET or POST, a header allowlist (incl. Cookie only for youtube.com consent), text or base64 bytes, redirects followed by hand.
   - It refuses loopback, private and link-local addresses on every hop (the local server on 127.0.0.1:23456 must stay unreachable) and limits the size.
   - The TS wrapper returns a `SourceFetch`.
   - Keep `apps/desktop/src/lib/__tests__/ipc-contract.test.ts` passing.

### Wave 2, after wave 1 is reviewed

- **Orchestrator (me):** `packages/core/src/sources.ts`, a dispatcher `fetchSourceCapture(url, deps)` that routes by `detectLinkKind`, resolves Reddit share links and sends PDF content types to the PDF extractor. Add exports to `index.ts`, `capture.ts` and `server.ts`.
- **web-app:**
  - `POST /api/source` (server fetch for web, reddit, pdf, hackernews and bluesky; youtube returns 422 "Save YouTube videos with the desktop app or the Sourcefold extension.").
  - Routing in `add-links-dialog.tsx` and `use-link-queue.ts`.
  - `item-row.tsx` icons, colors and the unavailable status text, the CSS tokens in `globals.css`, and the DESIGN.md rows.
- **desktop:**
  - A source client in the webview using `web_fetch`, and `AddLinksDialog` routing, including the YouTube playlist and channel listing like Substack publications.
  - `source-kinds.tsx`, `lib/types.ts`, `reader/open-decision.ts` and the CSS tokens.
- **extension:**
  - `capture.content.ts` handles YouTube (same-origin InnerTube), Reddit (same-origin `.json`), HN and Bluesky (public APIs with CORS), and other pages through defuddle.
  - Popup labels and the description in `wxt.config.ts`. PDFs: tell the user to use Add links.
- Then docs: `open-source-references.md` credits (youtube-transcript-api MIT, defuddle MIT, pdf.js Apache-2.0, Algolia HN API, AT Protocol), FILE-FORMAT, SPEC, ROADMAP and HANDOFF. Run all checks and commit. Ask the owner before applying the migration or pushing.

## Manual test steps to hand the owner at the end (draft)

- Desktop, Add links: paste a YouTube video with captions. It saves with a transcript, timestamp links open at the right second, and the description is at the end. A video with no captions shows "No captions on this video". Paste a playlist and check one row per video.
- The same YouTube video from the extension while watching it.
- Web and desktop: a Britannica or news article (clean text and images), a Reddit thread (post and nested comments), an arXiv link (HTML version), a plain `.pdf` link, a Hacker News item and a Bluesky post.
- Check the Drive files, Google Docs and local `.docx` copies appear for each new kind (these are generic, so they should just work).
- Migration `20261016000000_more_source_kinds.sql` must be applied before deploying, or saves of the new kinds fail the kind check.
