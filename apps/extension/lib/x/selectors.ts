// Stable DOM selectors and attribute names for extracting posts from X (Twitter).
// Centralized here so DOM changes in future X redesigns can be addressed in one file.

// Container element for an individual post on X.
export const POST_CONTAINER_SELECTOR = 'article[data-testid="tweet"]';

// Header block containing the author display name, handle, and profile link.
export const USER_NAME_SELECTOR = '[data-testid="User-Name"]';

// Element containing the tweet body text.
export const TWEET_TEXT_SELECTOR = '[data-testid="tweetText"]';

// Timestamp element holding the post creation datetime.
export const TIME_SELECTOR = "time[datetime]";

// Anchor link matching a status permalink.
export const PERMALINK_SELECTOR = 'a[href*="/status/"]';

// Link shown when long post text is truncated.
export const SHOW_MORE_SELECTOR = '[data-testid="tweet-text-show-more-link"]';

// Container wrapping an embedded quote post within an article.
export const QUOTED_POST_SELECTOR = 'div[role="link"]';

// Profile anchor link within the user name block.
export const PROFILE_LINK_SELECTOR = 'a[href^="/"]';

// Verification badges and icons inside the user name block.
export const VERIFIED_BADGE_SELECTOR = '[data-testid="icon-verified"], [aria-label*="Verified" i]';

// Datetime attribute name on time elements.
export const DATETIME_ATTR = "datetime";

// Anchor href attribute name.
export const HREF_ATTR = "href";

// Anchor title attribute name used on shortened links for the expanded URL.
export const TITLE_ATTR = "title";

// Image alt attribute name for emoji text.
export const ALT_ATTR = "alt";

// HTML line break tag name.
export const BR_TAG = "br";

// HTML image tag name.
export const IMG_TAG = "img";

// HTML anchor tag name.
export const A_TAG = "a";

// Media selectors for photo, GIF, and video extraction.
export const TWEET_PHOTO_SELECTOR = '[data-testid="tweetPhoto"]';
export const TWEET_PHOTO_IMG_SELECTOR = '[data-testid="tweetPhoto"] img';
export const VIDEO_PLAYER_SELECTOR = '[data-testid="videoPlayer"]';
export const VIDEO_COMPONENT_SELECTOR = '[data-testid="videoComponent"]';
export const VIDEO_TAG = "video";
export const SRC_ATTR = "src";
