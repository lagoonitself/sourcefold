import type { SubstackExtractResult } from "../capture-types";
import { substackBodyToMarkdown } from "./body";
import type { SubstackPreloads } from "./preloads";

const PAYWALL_MARKERS = ['data-component-name="PaywallToDOM"', 'class="paywall-jump"'];
const PAGE_PAYWALL_SELECTOR = '.paywall, [data-testid="paywall"], .paywall-title, .paywall-cta';
const NO_TEXT_BODY = "This post has no text. Listen or watch it on Substack.\n";

function cleanUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return raw.split("?")[0]!.split("#")[0]!;
  }
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function toIso(raw: string | null): string | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}

function visibleTextLength(html: string): number {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, "").length;
}

// A locked paid post has an empty body, or the free preview followed by the paywall marker and
// nothing after it. Subscribers get the marker too, but with the paid text after it.
function isLocked(bodyHtml: string, doc: Document): boolean {
  if (!bodyHtml.trim()) return true;
  for (const marker of PAYWALL_MARKERS) {
    const at = bodyHtml.lastIndexOf(marker);
    if (at !== -1) {
      const after = bodyHtml.slice(bodyHtml.indexOf(">", at) + 1);
      if (visibleTextLength(after) < 40) return true;
    }
  }
  return Boolean(doc.querySelector(PAGE_PAYWALL_SELECTOR));
}

/** Builds the capture from a post page's preloads. Returns null when the page has no post data. */
export function substackPostFromPreloads(
  preloads: SubstackPreloads,
  pageUrl: string,
  doc: Document,
): SubstackExtractResult | null {
  const post = preloads.post;
  if (!post) return null;

  const url = cleanUrl(post.canonicalUrl ?? preloads.canonicalUrl ?? pageUrl);
  const title = collapse(post.title);
  const paid = Boolean(post.audience) && post.audience !== "everyone";

  if (paid && isLocked(post.bodyHtml, doc)) {
    return { status: "paywalled", url, title };
  }

  const markdown = post.bodyHtml.trim() ? substackBodyToMarkdown(post.bodyHtml, title, doc) : "";

  const names = post.bylines.map((b) => b.name).filter((n): n is string => Boolean(n));
  const handle = post.bylines.find((b) => b.handle)?.handle ?? null;

  let publicationUrl: string | null = null;
  const base = preloads.pub?.baseUrl ?? null;
  try {
    publicationUrl = `${new URL(base ?? url).origin}/`;
  } catch {
    publicationUrl = null;
  }

  return {
    status: "ok",
    capture: {
      url,
      title,
      subtitle: post.subtitle ? collapse(post.subtitle) || null : null,
      author: names.length > 0 ? collapse(names.join(", ")) : null,
      authorUrl: handle ? `https://substack.com/@${handle}` : null,
      publication: preloads.pub?.name ? collapse(preloads.pub.name) : null,
      publicationUrl,
      published: toIso(post.postDate),
      access: paid ? "paid" : "free",
      markdown: markdown || NO_TEXT_BODY,
    },
  };
}
