import { xStatusId, type XPostCapture } from "@sourcefold/core";
import {
  A_TAG,
  ALT_ATTR,
  BR_TAG,
  DATETIME_ATTR,
  HREF_ATTR,
  IMG_TAG,
  PERMALINK_SELECTOR,
  POST_CONTAINER_SELECTOR,
  PROFILE_LINK_SELECTOR,
  QUOTED_POST_SELECTOR,
  SHOW_MORE_SELECTOR,
  TIME_SELECTOR,
  TITLE_ATTR,
  TWEET_TEXT_SELECTOR,
  USER_NAME_SELECTOR,
  VERIFIED_BADGE_SELECTOR,
} from "./selectors";

export type XExtractResult =
  | { status: "ok"; posts: XPostCapture[] } // posts[0] is the thread root, in reading order
  | { status: "error"; message: string };

interface ParsedPost {
  statusId: string;
  post: XPostCapture;
}

function matchesSelector(el: Element, selector: string): boolean {
  if (typeof el.matches === "function") {
    try {
      return el.matches(selector);
    } catch {
      return false;
    }
  }
  return false;
}

// Determines if an element is contained within a quoted-post subcontainer inside an article.
function isInsideQuotedPost(el: Element, article: Element): boolean {
  let current: Element | null = el.parentElement;
  while (current && current !== article) {
    if (
      matchesSelector(current, QUOTED_POST_SELECTOR) &&
      current.querySelector(USER_NAME_SELECTOR) !== null
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

// Determines if an element is contained within a tweet-text container inside an article.
function isInsideTweetText(el: Element, article: Element): boolean {
  let current: Element | null = el.parentElement;
  while (current && current !== article) {
    if (matchesSelector(current, TWEET_TEXT_SELECTOR)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

// Finds an element matching selector that belongs directly to the article (not inside a quoted post).
function findOwnElement(article: Element, selector: string): Element | null {
  const elements = Array.from(article.querySelectorAll(selector));
  return elements.find((el) => !isInsideQuotedPost(el, article)) ?? null;
}

// Finds the article's own status ID from permalink anchors, excluding links inside quoted posts or tweet text.
function findOwnStatusId(article: Element): string | null {
  const ownTime = findOwnElement(article, TIME_SELECTOR);
  if (ownTime) {
    const wrappingAnchor = ownTime.closest(PERMALINK_SELECTOR);
    if (
      wrappingAnchor &&
      !isInsideQuotedPost(wrappingAnchor, article) &&
      !isInsideTweetText(wrappingAnchor, article)
    ) {
      const rawHref = wrappingAnchor.getAttribute(HREF_ATTR) ?? "";
      const resolvedUrl = rawHref.startsWith("http")
        ? rawHref
        : new URL(rawHref, "https://x.com").href;
      const statusId = xStatusId(resolvedUrl);
      if (statusId) return statusId;
    }
  }

  const allPermalinks = Array.from(article.querySelectorAll(PERMALINK_SELECTOR));
  for (const anchor of allPermalinks) {
    if (isInsideQuotedPost(anchor, article) || isInsideTweetText(anchor, article)) {
      continue;
    }
    const rawHref = anchor.getAttribute(HREF_ATTR) ?? "";
    const resolvedUrl = rawHref.startsWith("http")
      ? rawHref
      : new URL(rawHref, "https://x.com").href;
    const statusId = xStatusId(resolvedUrl);
    if (statusId) return statusId;
  }

  return null;
}

// Extracts username handle from a relative or absolute profile URL.
function parseHandleFromHref(href: string): string | null {
  try {
    const url = new URL(href, "https://x.com");
    const path = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    const parts = path.split("/");
    if (parts.length > 0 && parts[0]) {
      const clean = parts[0].replace(/^@/, "");
      const lower = clean.toLowerCase();
      // Skip non-profile utility routes
      if (!["home", "explore", "notifications", "messages", "i", "search"].includes(lower)) {
        return clean;
      }
    }
  } catch {
    // Ignore invalid URLs
  }
  return null;
}

// Extracts the author's handle without leading @ from the User-Name block.
function extractHandle(userNameEl: Element): string | null {
  const links = Array.from(userNameEl.querySelectorAll(PROFILE_LINK_SELECTOR));

  // 1. Look for a profile anchor whose text starts with '@' (e.g. '@handle')
  for (const link of links) {
    const href = link.getAttribute(HREF_ATTR);
    if (!href || href.includes("/status/")) continue;
    const text = link.textContent?.trim() ?? "";
    if (text.startsWith("@")) {
      const match = text.slice(1).match(/^[A-Za-z0-9_]+/);
      if (match) return match[0];
    }
  }

  // 2. Parse handle from profile link href
  for (const link of links) {
    const href = link.getAttribute(HREF_ATTR);
    if (!href || href.includes("/status/")) continue;
    const fromHref = parseHandleFromHref(href);
    if (fromHref) return fromHref;
  }

  // 3. Fallback: match @handle pattern anywhere in text
  const match = userNameEl.textContent?.match(/@([A-Za-z0-9_]+)/);
  if (match && match[1]) {
    return match[1];
  }

  return null;
}

// Helper to extract text from a node tree preserving emoji image alt text.
function extractTextWithEmojis(node: Node): string {
  if (node.nodeType === 3 /* Node.TEXT_NODE */) {
    return node.nodeValue ?? "";
  }
  if (node.nodeType === 1 /* Node.ELEMENT_NODE */) {
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === IMG_TAG) {
      return el.getAttribute(ALT_ATTR) ?? "";
    }
    let res = "";
    for (const child of Array.from(el.childNodes)) {
      res += extractTextWithEmojis(child);
    }
    return res;
  }
  return "";
}

// Extracts the author's display name, excluding verification badges and the @handle.
function extractAuthorName(userNameEl: Element, handle: string): string {
  const clone = userNameEl.cloneNode(true) as Element;

  // Remove status permalinks and time elements if nested in the User-Name row
  for (const el of Array.from(clone.querySelectorAll(TIME_SELECTOR))) {
    el.remove();
  }
  for (const el of Array.from(clone.querySelectorAll(PERMALINK_SELECTOR))) {
    el.remove();
  }

  // Remove verification badges and SVG icons
  for (const el of Array.from(clone.querySelectorAll(VERIFIED_BADGE_SELECTOR))) {
    el.remove();
  }
  for (const el of Array.from(clone.querySelectorAll("svg"))) {
    el.remove();
  }

  // Remove the handle element (@handle)
  const allElements = Array.from(clone.querySelectorAll("*"));
  for (const el of allElements) {
    const trimmed = el.textContent?.trim() ?? "";
    if (
      trimmed === `@${handle}` ||
      trimmed.toLowerCase() === `@${handle.toLowerCase()}` ||
      (trimmed.startsWith("@") && trimmed.slice(1).toLowerCase().startsWith(handle.toLowerCase()))
    ) {
      let target: Element = el;
      while (
        target.parentElement &&
        target.parentElement !== clone &&
        (target.parentElement.textContent?.trim() === trimmed ||
          target.parentElement.textContent?.trim() === `@${handle}`)
      ) {
        target = target.parentElement;
      }
      target.remove();
      break;
    }
  }

  // Clean any remaining elements that explicitly start with '@'
  for (const el of Array.from(clone.querySelectorAll("*"))) {
    const text = el.textContent?.trim() ?? "";
    if (text.startsWith("@")) {
      el.remove();
    }
  }

  const rawName = extractTextWithEmojis(clone);
  const collapsed = rawName
    .replace(/^[\s·•·]+|[\s·•·]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return collapsed || handle;
}

// Faithfully extracts tweet text: <br> -> \n, emoji img[alt] -> alt text,
// t.co links -> expanded title or trimmed visible text, and preserves newlines.
function extractTweetText(tweetTextEl: Element): string {
  function walk(node: Node): string {
    if (node.nodeType === 3 /* Node.TEXT_NODE */) {
      return node.nodeValue ?? "";
    }
    if (node.nodeType === 1 /* Node.ELEMENT_NODE */) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();

      // Skip the "Show more" button/link inside tweetText so the literal text "Show more" isn't appended.
      // Note: The post text may be truncated if not expanded.
      if (matchesSelector(el, SHOW_MORE_SELECTOR)) {
        return "";
      }

      if (tag === BR_TAG) {
        return "\n";
      }

      if (tag === IMG_TAG) {
        return el.getAttribute(ALT_ATTR) ?? "";
      }

      if (tag === A_TAG) {
        const href = el.getAttribute(HREF_ATTR) ?? "";
        const title = el.getAttribute(TITLE_ATTR);
        let linkText = "";
        for (const child of Array.from(el.childNodes)) {
          linkText += walk(child);
        }

        // For t.co links whose visible text ends with '…' or '...',
        // prefer the expanded URL from the title attribute if available.
        // If not, strip the trailing ellipsis from the visible text.
        if (href.includes("t.co")) {
          const isTruncated = /(?:…|\.\.\.)$/.test(linkText.trim());
          if (isTruncated) {
            if (title && (title.startsWith("http://") || title.startsWith("https://"))) {
              return title;
            }
            return linkText.replace(/(?:…|\.\.\.)\s*$/, "");
          }
        }
        return linkText;
      }

      // Add newlines between block elements (e.g. p or inner div) if present
      const isBlock = tag === "p" || (tag === "div" && el !== tweetTextEl);
      let text = "";
      for (const child of Array.from(el.childNodes)) {
        text += walk(child);
      }
      return isBlock && text ? `${text}\n` : text;
    }
    return "";
  }

  const raw = walk(tweetTextEl);
  return raw.replace(/\r\n/g, "\n").trim();
}

// Reads the open X status page and returns the target post plus the author's own connected thread.
export function extractXThread(doc: Document, pageUrl: string): XExtractResult {
  try {
    const targetStatusId = xStatusId(pageUrl);
    if (!targetStatusId) {
      return { status: "error", message: "Open a single X post to save it." };
    }

    const articles = Array.from(doc.querySelectorAll(POST_CONTAINER_SELECTOR));

    interface ArticleCandidate {
      statusId: string | null;
      handle: string;
      authorName: string;
      authorUrl: string;
      postedAt: string | null;
      text: string;
      hasOwnTimeWithoutWrappingLink: boolean;
    }

    const candidates: ArticleCandidate[] = [];

    for (const article of articles) {
      const userNameEl = findOwnElement(article, USER_NAME_SELECTOR);
      const handle = userNameEl ? extractHandle(userNameEl) : null;
      if (!handle) {
        continue;
      }

      const ownTime = findOwnElement(article, TIME_SELECTOR);
      const statusId = findOwnStatusId(article);

      const wrappingAnchor = ownTime?.closest(PERMALINK_SELECTOR);
      const hasWrappingAnchor = Boolean(
        wrappingAnchor &&
        !isInsideQuotedPost(wrappingAnchor, article) &&
        !isInsideTweetText(wrappingAnchor, article),
      );
      const hasOwnTimeWithoutWrappingLink = Boolean(ownTime && !hasWrappingAnchor);

      const authorName = userNameEl ? extractAuthorName(userNameEl, handle) : handle;
      const authorUrl = `https://x.com/${handle}`;
      const postedAt = ownTime?.getAttribute(DATETIME_ATTR) ?? null;

      const ownTweetText = findOwnElement(article, TWEET_TEXT_SELECTOR);
      const text = ownTweetText ? extractTweetText(ownTweetText) : "";

      candidates.push({
        statusId,
        handle,
        authorName,
        authorUrl,
        postedAt,
        text,
        hasOwnTimeWithoutWrappingLink,
      });
    }

    // If no own status id is found for an article and the page has exactly one such article
    // that looks like the focal post (e.g. its own time element has no wrapping link),
    // assign it xStatusId(pageUrl). Keep it conservative.
    const alreadyFoundTarget = candidates.some((c) => c.statusId === targetStatusId);
    if (!alreadyFoundTarget) {
      const focalCandidates = candidates.filter(
        (c) => !c.statusId && c.hasOwnTimeWithoutWrappingLink,
      );
      if (focalCandidates.length === 1 && focalCandidates[0]) {
        focalCandidates[0].statusId = targetStatusId;
      }
    }

    const parsedPosts: ParsedPost[] = [];
    for (const c of candidates) {
      if (c.statusId) {
        parsedPosts.push({
          statusId: c.statusId,
          post: {
            postUrl: `https://x.com/${c.handle}/status/${c.statusId}`,
            authorName: c.authorName,
            handle: c.handle,
            authorUrl: c.authorUrl,
            postedAt: c.postedAt,
            text: c.text,
          },
        });
      }
    }

    const targetIndex = parsedPosts.findIndex((p) => p.statusId === targetStatusId);
    if (targetIndex === -1) {
      return {
        status: "error",
        message: "Couldn't find the post on this page. Scroll to it and try again.",
      };
    }

    const targetPost = parsedPosts[targetIndex];
    if (!targetPost) {
      return {
        status: "error",
        message: "Couldn't find the post on this page. Scroll to it and try again.",
      };
    }

    const targetHandle = targetPost.post.handle.toLowerCase();

    // Walk upward while the previous post has the same handle
    let startIndex = targetIndex;
    while (startIndex > 0) {
      const prev = parsedPosts[startIndex - 1];
      if (prev && prev.post.handle.toLowerCase() === targetHandle) {
        startIndex--;
      } else {
        break;
      }
    }

    // Walk downward while the next post has the same handle
    let endIndex = targetIndex;
    while (endIndex < parsedPosts.length - 1) {
      const next = parsedPosts[endIndex + 1];
      if (next && next.post.handle.toLowerCase() === targetHandle) {
        endIndex++;
      } else {
        break;
      }
    }

    const threadPosts = parsedPosts.slice(startIndex, endIndex + 1).map((p) => p.post);
    const targetInThread = targetIndex - startIndex;

    let posts = threadPosts;
    if (posts.length > 50) {
      // Cap at 50 posts (the API rejects > 50): keep the target post and take posts from the thread root forward;
      // if that exceeds 50, take a 50-post window that includes the target.
      if (targetInThread < 50) {
        posts = posts.slice(0, 50);
      } else {
        const windowStart = Math.min(targetInThread - 49, posts.length - 50);
        posts = posts.slice(windowStart, windowStart + 50);
      }
    }

    return { status: "ok", posts };
  } catch {
    return {
      status: "error",
      message: "Couldn't read this X page. Reload it and try again.",
    };
  }
}
