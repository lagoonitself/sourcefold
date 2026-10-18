# Open-source references

Projects to study or borrow from while building the source collector. Check each repo's license and recent activity before copying code.

## Grokipedia

- No open-source Grokipedia scraper found (2026-10-13).
- Not needed: a plain HTTP GET of `https://grokipedia.com/page/<Title>` returns the full article HTML, including the body text, the `<meta name="description">` (first paragraph), and the reference links. Tested from a home connection; not yet tested from a cloud host.
- [Grokipedia.com Scraper (Apify)](https://digitalbiztalk.com/tools/apify-actors/clearpath/grokipedia-scraper) - hosted, not open source; useful only to see which fields others extract.

## Substack

- [Substack2Markdown (timf34)](https://github.com/timf34/Substack2Markdown) - Python. Free and premium posts to Markdown; premium requires your own subscribed account.
- [Substack2Markdown (nateProjects fork)](https://github.com/nateProjects/Substack2Markdown) - fork of the above.
- [KitSubStack](https://github.com/kitmodule/kitsubstack-js) - JavaScript, MIT, no dependencies. Fetches posts and converts to Markdown with front matter.
- [Substack Clipper](https://community.obsidian.md/plugins/substack-clipper) - Obsidian plugin, MIT. Saves public posts as Markdown.
- [sbstck-dl](https://github.com/alexferrari88/sbstck-dl) - Go CLI, MIT. **Used:** its method is ported to TypeScript in `packages/core/src/substack/` (post data from `window._preloads`, publication listing from the archive API and sitemap, cookie for paid posts, rate limiting).
- [substackdownloader.com](https://substackdownloader.com) - free web tool, not confirmed open source. Paid posts work by pasting your browser session cookie. Outputs Markdown, DOCX, PDF. Our extension avoids the cookie step because it reads the page while you are logged in.

## X (Twitter)

- [tweet2md](https://chromewebstore.google.com/detail/epmmehilhbpkgcjbcohgkmihlalagkho) - Chrome extension, threads/posts/articles to Markdown, no API key. Listed as open source; repo link not yet confirmed.
- [X Thread to Markdown](https://addons.mozilla.org/de/firefox/addon/x-thread-to-markdown/) - Firefox add-on. Captures the post, the author's self-thread and the reply tree. Ships unminified code, so it is readable for reference.

## YouTube transcripts

- [youtube-transcript-api (jdepoix)](https://github.com/jdepoix/youtube-transcript-api) - Python, MIT. **Used:** its method is ported to TypeScript in `packages/core/src/youtube/`: read `INNERTUBE_API_KEY` from the watch page (accepting the EU consent page with a `CONSENT` cookie), ask InnerTube's `player` endpoint as the Android client for the caption tracks, prefer written captions in the spoken language, then fetch the track's timedtext XML. No API key of the user's own and no cost. YouTube blocks cloud servers, so this runs in the desktop app and the extension, never on Vercel.
- Playlist and channel listing (`packages/core/src/youtube/list.ts`) reads the page's `ytInitialData` and follows InnerTube `browse` continuations as the web client; written from the page data, no library.

## Web pages

- [Defuddle (kepano)](https://github.com/kepano/defuddle) - TypeScript, MIT, the extractor behind Obsidian Web Clipper. **Used** (`defuddle` 0.19.5, `packages/core/src/web-page/`): finds the main content and metadata of any page; Turndown then makes the Markdown. Runs on linkedom on the server and on the live DOM in the extension.

## PDFs and arXiv

- [pdf.js (Mozilla)](https://github.com/mozilla/pdf.js) - Apache-2.0. **Used** (`pdfjs-dist`, `packages/core/src/pdf/`): text from any PDF, rebuilt into paragraphs.
- arXiv's own HTML versions (`https://arxiv.org/html/<id>`) and its Atom API (`export.arxiv.org/api/query`) for papers; the PDF is the fallback.

## Reddit, Hacker News, Bluesky

- Reddit's public `.json` for a post (no library, no login). Reddit blocks most servers and scripted clients; the extension reads it from the open thread.
- [Hacker News Algolia API](https://hn.algolia.com/api) (`/api/v1/items/<id>`), the official public API with the whole comment tree in one request.
- Bluesky's public AppView (`public.api.bsky.app`, AT Protocol): `com.atproto.identity.resolveHandle` and `app.bsky.feed.getPostThread`, no login.

## General building blocks

- [Mozilla Readability](https://github.com/mozilla/readability) - extracts the main article content from a page.
- [Turndown](https://github.com/mixmark-io/turndown) - converts HTML to Markdown (tables via the GFM plugin).
- [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) - open-source browser clipper that saves pages as Markdown; good reference for extension structure.
- [doc-bot-chrome](https://github.com/Rajeev-SG/doc-bot-chrome) - Chrome extension, page to Markdown via the Jina Reader API.
