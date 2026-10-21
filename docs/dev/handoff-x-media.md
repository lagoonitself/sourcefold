# Handoff: photos and GIFs in saved X posts

Owner's request (2026-10-21): when an X post or thread is saved, save its photos and GIFs with it. Videos are skipped: the post just links to them. Branch `x-media`.

## Decisions (made by the orchestrator; don't revisit)

- **Where media comes from.** By status id, from X's embed service (`cdn.syndication.twimg.com/tweet-result`), falling back to FxTwitter (`api.fxtwitter.com/2/status/<id>`, MIT, github.com/FixTweet/FxTwitter). Neither needs a login or key; both were checked live on 2026-10-21. If both fail, the extension's own reading of the page (DOM) is used. Real responses are saved in `packages/core/src/x/fixtures/`.
- **Who fetches.** The extension's popup, right before it sends the capture. It's an extension page, so with host permissions it isn't held back by CORS (the embed service only allows `platform.twitter.com`). The web server and the desktop only validate, store and render what they receive. Nothing else fetches X.
- **What's saved.** Photos at full size, `https://pbs.twimg.com/media/<id>.<ext>?name=orig`. GIFs are MP4 files on X (`https://video.twimg.com/tweet_video/<id>.mp4`) and are saved as that MP4. Videos are never downloaded; the file gets a link to the post.
- **How it's saved.** As Markdown image lines in the X file. The existing "post images" code (docs/FILE-FORMAT.md, "Post images") then downloads every `![](https://…)` into `<Title>_files/` in Drive and in the desktop's local copy. That code learns one new extension, `mp4`.
- **Quoted posts:** only the saved post's own media, never a quoted post's.
- **Limit:** at most 10 media items per post (X allows 4).

## Shared type (already in `packages/core/src/capture-types.ts`, exported from `@sourcefold/core`)

```ts
export type XMedia =
  | { type: "photo"; url: string; alt: string | null }
  | { type: "gif"; url: string; alt: string | null }
  | { type: "video"; durationSeconds: number | null };

interface XPostCapture { …existing; media?: XMedia[] }   // missing = none known
interface XTreeNode    { …existing; media?: XMedia[] }
```

JSON on the wire uses exactly these field names (`type`, `url`, `alt`, `durationSeconds`).

## Validation rules ("normalize"; web and desktop apply the same rules)

Input is untrusted JSON. Go through the array in order, **drop** any element that fails (never reject the whole request), and keep at most 10.

- `photo`: `url` is a string that parses as a URL, protocol `https:`, host exactly `pbs.twimg.com`, path starts with `/media/`. `alt`: a string, trimmed, at most 1000 characters (longer is cut), empty → `null`; anything else → `null`.
- `gif`: `url` parses, `https:`, host exactly `video.twimg.com`, path starts with `/tweet_video/` and ends with `.mp4`. `alt` as for photo.
- `video`: `durationSeconds` is a finite number, 0 ≤ n ≤ 86400, else `null`. Any `url` field is ignored and not kept.
- Any other `type`, or a non-object element: dropped. A `media` that is missing or not an array → `[]`.

TS: `normalizeXMedia(raw: unknown): XMedia[]` in `packages/core/src/x/media.ts`. Rust: `normalize_x_media(raw: &serde_json::Value) -> Vec<XMedia>` in the desktop.

## Markdown (the X file body)

Each post's block is unchanged except:

1. When a post has media, each item becomes its own paragraph after the post's text. Each is preceded by one blank line, written with the post's quote prefix like the existing blank lines (`>` / `> >`, trimmed at the end).
2. When a post's text is empty after trimming, no text lines are written; the header is followed directly by the media paragraphs. The TS renderer changes to match; the Rust one already skips empty text.

Media lines:

- photo: `![<alt>](<url>)`; alt text `Image` when `alt` is null.
- gif: `![<alt>](<url>)`; alt text `GIF` when `alt` is null.
- video: `[Video (<duration>) on X](<postUrl>)`, or `[Video on X](<postUrl>)` when `durationSeconds` is null. Duration: round to whole seconds; under an hour `m:ss` (`0:07`, `1:00`), otherwise `h:mm:ss` (`1:02:05`).

Alt text: replace each run of whitespace with one space, trim, cut to 300 characters (characters, not bytes), then escape `\` as `\\`, `[` as `\[` and `]` as `\]`.

**Shared fixture:** `packages/core/test/x-media/thread.nodes.json` (input nodes) and `thread.body.md` (expected body, without the `# Title` line). The TS test checks `renderXThreadMarkdown(nodes, "T")` equals `"# T\n\n" + body`, comparing with trailing whitespace trimmed on both sides. The Rust test checks `render_x_thread_body(nodes)` equals the body, trailing whitespace trimmed on both sides. Don't edit the fixture; if you think it's wrong, report it.

## Fetching (core, used by the extension)

`fetchXPostMedia(fetch: SourceFetch, statusId: string, signal?: AbortSignal): Promise<XMedia[] | null>` in `packages/core/src/x/media.ts`. `null` means "couldn't find out"; `[]` means "the post has no media".

1. `statusId` must match `/^\d{1,25}$/`, else `null`.
2. GET `https://cdn.syndication.twimg.com/tweet-result?id=<id>&lang=en&token=<token>`, with `token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "")` (what Vercel's react-tweet does). It's usable when the status is 200, the body parses as JSON, and `__typename === "Tweet"`. Then map `mediaDetails` (missing → `[]`):
   - `type: "photo"` → `{ type: "photo", url: <media_url_https without query> + "?name=orig", alt: ext_alt_text ?? null }`
   - `type: "animated_gif"` → `{ type: "gif", url: <first video_info.variants entry with content_type "video/mp4">.url without query, alt: ext_alt_text ?? null }`
   - `type: "video"` → `{ type: "video", durationSeconds: video_info.duration_millis / 1000 }` (`null` if missing)
3. Otherwise (other status, HTML, tombstone, network error, thrown error), GET `https://api.fxtwitter.com/2/status/<id>`. Usable when the status is 200 and the JSON has `status`. Map `status.media.all` (missing → `[]`): `photo` → `url`, `altText`; `gif` → `url`; `video` → `duration` (seconds). Check the exact shapes against the fixtures.
4. Both unusable → `null`. The result always goes through `normalizeXMedia`.

## Work packages and file ownership

Only edit files you own. Several agents work in this checkout at once. Follow `AGENTS.md` (no git commands, no new dependencies, report at the end).

### A: core (`packages/core`)

Owns `packages/core/src/x/**` (except `fixtures/`, read-only), `packages/core/src/post-images.ts` and its test, `packages/core/src/index.ts`, and new tests in `packages/core/test/`.

- `src/x/media.ts`: `normalizeXMedia`, `fetchXPostMedia`, and `formatXMediaLine(media: XMedia, postUrl: string): string` (the media line rules above). Export all three from `index.ts`.
- `src/x/markdown.ts`: render media and skip empty text as specified. Existing tests keep passing, except any that pinned the old empty-text output: update those and say so in your report.
- Tests: `media.test.ts` (parsing every fixture in `src/x/fixtures/` with a fake `SourceFetch`; fallback order; `null` cases; normalize rules, including hostile URLs like `https://pbs.twimg.com.evil.com/media/x`, `http://`, `javascript:` and wrong paths; duration formatting), plus the shared fixture test.
- `post-images.ts`: add `mp4` to the known extensions. Add `postImageFileNames` cases: `https://pbs.twimg.com/media/AAA111.jpg?name=orig` → `AAA111.jpg`; `https://video.twimg.com/tweet_video/CCC333.mp4` → `CCC333.mp4`.

### B: extension (`apps/extension`)

Owns `apps/extension/**`.

- `wxt.config.ts`: add `https://cdn.syndication.twimg.com/*` and `https://api.fxtwitter.com/*` to `host_permissions`.
- `lib/x/selectors.ts` + `lib/x/extract.ts`: each post also gets `media` read from the page, in page order, from the post's own article only (skip anything inside a quoted post; reuse `isInsideQuotedPost`):
  - Photos: `[data-testid="tweetPhoto"] img` whose `src` is on `pbs.twimg.com/media/`. Turn `https://pbs.twimg.com/media/<id>?format=<ext>&name=<size>` into `https://pbs.twimg.com/media/<id>.<ext>?name=orig` (format missing → `jpg`). `alt` is the img's `alt`, or `null` when it's empty or exactly `Image` (X's default).
  - GIFs: a `video` whose `src` starts with `https://video.twimg.com/tweet_video/` → `{ type: "gif", url: src without query, alt: null }`.
  - Videos: a `[data-testid="videoPlayer"]` or `[data-testid="videoComponent"]` that isn't a GIF → `{ type: "video", durationSeconds: null }`. Count one per player.
  - Add DOM fixtures/tests next to the existing extractor tests.
- `lib/x/media.ts` (new): `enrichXPostsMedia(posts: XPostCapture[]): Promise<XPostCapture[]>`. For each post, `xStatusId(post.postUrl)` → `fetchXPostMedia(sourceFetchFromGlobalFetch(...), id, signal)` (check `packages/core/src/source-fetch.ts` for the helper's exact signature), at most 4 at a time, 8 s timeout per post, 20 s overall. A non-null result replaces the post's `media`; `null`, a timeout or an error keeps the page's media. Never throws. Tests with a fake fetch.
- `entrypoints/popup/App.tsx`: call `enrichXPostsMedia` on `res.posts` right before `capture({ kind: "x", … })`, and on the single post before `addXPost` (add to thread). No new UI; the existing "Saving…" state covers the wait.
- `fetchXPostMedia` and `normalizeXMedia` come from package A, which is written at the same time. Import them from `@sourcefold/core` and don't write your own. If they aren't there yet when you run checks, wait a few minutes and run again.

### C: web (`apps/web`)

Owns `apps/web/**` except `src/lib/database.types.ts` (already has `x_posts.media: Json`; the migration `supabase/migrations/20261021000000_x_post_media.sql` is applied).

- `app/api/capture/route.ts`: `xPostCaptureSchema` gets `media: z.array(z.unknown()).max(20).optional()`. Same for the post body of `app/api/x/[itemId]/posts/route.ts`.
- Everywhere X posts are saved (`features/capture/save-x.ts`, the posts route): run `normalizeXMedia(post.media)` from `@sourcefold/core` and store the result in `x_posts.media`.
- Everywhere `x_posts` rows become `XTreeNode`s (`rerenderXItem`, the posts route and any other place: grep `x_posts`): select `media`, pass `normalizeXMedia(row.media)` as the node's `media`. That's how the Markdown, the Drive file and the image folder pick it up.
- `features/drive/post-images.ts`: when the URL's path ends in `.mp4`, also accept `video/mp4` as the content type (still capped at 25 MB). Images are unchanged.
- `features/drive/google-doc.ts`, `image()` renderer: when the URL's path ends in `.mp4`: for `https://video.twimg.com/tweet_video/<id>.mp4`, write `<a href="<mp4>"><img src="https://pbs.twimg.com/tweet_video_thumb/<id>.jpg" alt="<text>" style="max-width:…"></a>` (same width rule as images); for any other `.mp4`, write `<a href="<url>"><text or "Video"></a>`. Escape as the existing code does.
- Tests for each of the above (route validation drops bad media and keeps good; rows with media re-render with image lines; post-images accepts mp4 only for `.mp4` paths; google-doc GIF thumbnail).
- `normalizeXMedia` comes from package A, written at the same time; same rule as B.

### D: desktop (`apps/desktop`)

Owns `apps/desktop/**`.

- `src-tauri/src/service.rs`: `XMedia` (serde, tagged by `type`: `photo` / `gif` / `video`; fields `url`, `alt`, `durationSeconds`) and `normalize_x_media` with the rules above. `XPostCapture.media` arrives as raw JSON (`#[serde(default)] Vec<serde_json::Value>` or `Value`) so one bad element never fails the request, and is normalized on the way in. `XTreeNode` gets `media: Vec<XMedia>`. Fill it everywhere nodes are built (`build_x_thread_markdown`, `save_x_thread`, the append-post path around `get_x_posts`, and any other).
- `render_x_node_block`: media lines per the rules above. Add a test that reads `packages/core/test/x-media/thread.nodes.json` and `thread.body.md` (see how `test_golden_fixtures` finds the folder) and compares as specified.
- `src-tauri/src/db.rs`: `x_posts.media TEXT NOT NULL DEFAULT '[]'` (JSON), added with the same mechanism db.rs already uses for new columns on existing databases. Insert and read it.
- `src-tauri/src/local_copy.rs`: `image_file_names` learns `mp4`, matching the TS cases in package A (add both to `image_file_names_match_the_web_app`). The image download also accepts `video/mp4` when the URL path ends in `.mp4`.
- Reader (`src/features/reader/render-markdown.ts` and its sanitizer): an image whose URL path ends in `.mp4` renders as `<video src="…" autoplay loop muted playsinline></video>`, styled like reader images. Allow only that tag and those attributes, and only `https:` or relative `src`. Add a test.
- Run `cargo test` in `apps/desktop/src-tauri` as well as the npm checks.

## After the agents (orchestrator)

Review each diff against HEAD (look for removed functions and tests). Then update `docs/FILE-FORMAT.md` (X media lines, `mp4` in post images), `docs/dev/SPEC.md`, `HANDOFF.md`, `ROADMAP.md`, `CHANGELOG.md`, and commit.
