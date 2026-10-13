# X (Twitter) Post & Thread Extraction

This module extracts the target post and its author's connected thread from a live X status page (`https://x.com/<handle>/status/<id>`).

## How It Works

1. **Target Identification**:
   - Parses the target status ID from `pageUrl` via `xStatusId()`.
   - Returns an error if the URL is not a single post URL (`Open a single X post to save it.`).

2. **Article Parsing**:
   - Locates all `article[data-testid="tweet"]` in document order.
   - Ignores nested elements inside quoted posts (`div[role="link"]` containing another `[data-testid="User-Name"]`) to avoid mixing quoted content or author metadata into the outer tweet.
   - Extracts the post's own permalink from `time[datetime]`'s wrapping anchor (`a[href*="/status/"]`).
   - Extracts the author's handle from the profile link `a[href^="/"]` in `[data-testid="User-Name"]`.
   - Extracts the author's display name by stripping verification badges, status links, and the `@handle` from `[data-testid="User-Name"]`, collapsing whitespace and preserving emoji alt text.
   - Extracts post text faithfully: `<br>` tags become newlines (`\n`), emojis (`img[alt]`) are replaced with their alt text, and truncated `t.co` links end-resolved via `title` (or trimmed of trailing `…`). If a post is media-only, text defaults to `""`.
   - Captures visible text as-is if truncated by a "Show more" link without clicking or mutating the DOM.

3. **Author's Connected Thread Assembly**:
   - Locates the index of the target post matching the status ID. If missing, returns an error prompting the user to scroll to it.
   - Walks upward from the target post while contiguous preceding articles share the same author handle.
   - Walks downward from the target post while contiguous succeeding articles share the same author handle.
   - Returns all matching posts in document order (root post at index 0).

## What to Change When X Changes Its Markup

All DOM selectors and attribute names are centralized in `selectors.ts`:

- **Container Selector**: Update `POST_CONTAINER_SELECTOR` if X changes the `article[data-testid="tweet"]` wrapper.
- **Author Information**: Update `USER_NAME_SELECTOR` or `PROFILE_LINK_SELECTOR` if X alters the user header layout.
- **Tweet Text**: Update `TWEET_TEXT_SELECTOR` if X renames `[data-testid="tweetText"]`.
- **Timestamp & Permalinks**: Update `TIME_SELECTOR` or `PERMALINK_SELECTOR` if X changes how status links and `time` elements are placed.
- **Quoted Posts**: Update `QUOTED_POST_SELECTOR` if embedded tweets no longer use `div[role="link"]`.
- **Truncation**: Update `SHOW_MORE_SELECTOR` if X renames the show-more link test id.
