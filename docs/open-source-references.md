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
- [sbstck-dl](https://repos.ecosyste.ms/topics/substack) - Go CLI for archiving newsletters.
- [substackdownloader.com](https://substackdownloader.com) - free web tool, not confirmed open source. Paid posts work by pasting your browser session cookie. Outputs Markdown, DOCX, PDF. Our extension avoids the cookie step because it reads the page while you are logged in.

## X (Twitter)

- [tweet2md](https://chromewebstore.google.com/detail/epmmehilhbpkgcjbcohgkmihlalagkho) - Chrome extension, threads/posts/articles to Markdown, no API key. Listed as open source; repo link not yet confirmed.
- [X Thread to Markdown](https://addons.mozilla.org/de/firefox/addon/x-thread-to-markdown/) - Firefox add-on. Captures the post, the author's self-thread and the reply tree. Ships unminified code, so it is readable for reference.

## General building blocks

- [Mozilla Readability](https://github.com/mozilla/readability) - extracts the main article content from a page.
- [Turndown](https://github.com/mixmark-io/turndown) - converts HTML to Markdown (tables via the GFM plugin).
- [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) - open-source browser clipper that saves pages as Markdown; good reference for extension structure.
- [doc-bot-chrome](https://github.com/Rajeev-SG/doc-bot-chrome) - Chrome extension, page to Markdown via the Jina Reader API.
