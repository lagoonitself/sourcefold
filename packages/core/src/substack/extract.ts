import { Readability } from "@mozilla/readability";
import type { SubstackCapture, SubstackExtractResult } from "../capture-types";
import { htmlToMarkdown } from "../html-to-markdown";
import { substackBodyToMarkdown } from "./body";
import { substackPostFromPreloads } from "./post";
import { findSubstackPreloads } from "./preloads";

interface JsonLdArticle {
  headline?: string;
  description?: string;
  datePublished?: string;
  url?: string;
  isAccessibleForFree?: boolean | string;
  authorName?: string;
  authorUrl?: string;
  publisherName?: string;
  publisherUrl?: string;
}

const SELECTORS_TO_REMOVE = [
  "figure",
  ".captioned-image-container",
  ".image-link",
  "img",
  "picture",
  ".subscription-widget-wrap",
  ".subscription-widget",
  ".subscribe-widget",
  ".button-wrapper",
  ".post-ufi",
  ".comments-section",
  "#discussion",
  ".share-dialog",
  ".footer",
  '[data-component-name="ButtonCreateButton"]',
  '[data-component-name="SubscribeWidgetToDOM"]',
  ".digest-post-embed",
  ".embedded-post-wrap",
];

function isSubstackHostname(hostname: string): boolean {
  return hostname === "substack.com" || hostname.endsWith(".substack.com");
}

function isSubstackUrl(urlStr: string | null | undefined): boolean {
  if (!urlStr) return false;
  try {
    const url = new URL(urlStr);
    return isSubstackHostname(url.hostname);
  } catch {
    return false;
  }
}

function isSubstackPlatform(doc: Document, pageUrl: string): boolean {
  const generator = doc.querySelector('meta[name="generator"]')?.getAttribute("content");
  if (generator?.toLowerCase() === "substack") {
    return true;
  }

  if (doc.querySelector('link[href*="substackcdn.com"], script[src*="substackcdn.com"]')) {
    return true;
  }

  const ogUrl = doc.querySelector('meta[property="og:url"]')?.getAttribute("content");
  if (isSubstackUrl(ogUrl)) {
    return true;
  }

  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
  if (isSubstackUrl(canonical)) {
    return true;
  }

  if (isSubstackUrl(pageUrl)) {
    return true;
  }

  return false;
}

function findArticleInJson(obj: unknown): JsonLdArticle | null {
  if (!obj || typeof obj !== "object") return null;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findArticleInJson(item);
      if (found) return found;
    }
    return null;
  }

  const record = obj as Record<string, unknown>;
  if (Array.isArray(record["@graph"])) {
    for (const item of record["@graph"]) {
      const found = findArticleInJson(item);
      if (found) return found;
    }
  }

  const type = record["@type"];
  let isArticle = false;
  if (typeof type === "string") {
    isArticle = type === "NewsArticle" || type === "Article";
  } else if (Array.isArray(type)) {
    isArticle = type.includes("NewsArticle") || type.includes("Article");
  }

  if (isArticle) {
    const headline = typeof record.headline === "string" ? record.headline : undefined;
    const description = typeof record.description === "string" ? record.description : undefined;
    const datePublished =
      typeof record.datePublished === "string" ? record.datePublished : undefined;
    const url = typeof record.url === "string" ? record.url : undefined;
    const isAccessibleForFree =
      typeof record.isAccessibleForFree === "boolean" ||
      typeof record.isAccessibleForFree === "string"
        ? record.isAccessibleForFree
        : undefined;

    let authorName: string | undefined;
    let authorUrl: string | undefined;
    const authorRaw = record.author;
    if (authorRaw) {
      const authorObj = Array.isArray(authorRaw) ? authorRaw[0] : authorRaw;
      if (typeof authorObj === "string") {
        authorName = authorObj;
      } else if (authorObj && typeof authorObj === "object") {
        const aRecord = authorObj as Record<string, unknown>;
        if (typeof aRecord.name === "string") {
          authorName = aRecord.name;
        }
        if (typeof aRecord.url === "string") {
          authorUrl = aRecord.url;
        }
      }
    }

    let publisherName: string | undefined;
    let publisherUrl: string | undefined;
    const pubRaw = record.publisher;
    if (pubRaw) {
      const pubObj = Array.isArray(pubRaw) ? pubRaw[0] : pubRaw;
      if (typeof pubObj === "string") {
        publisherName = pubObj;
      } else if (pubObj && typeof pubObj === "object") {
        const pRecord = pubObj as Record<string, unknown>;
        if (typeof pRecord.name === "string") {
          publisherName = pRecord.name;
        }
        if (typeof pRecord.url === "string") {
          publisherUrl = pRecord.url;
        }
      }
    }

    return {
      headline,
      description,
      datePublished,
      url,
      isAccessibleForFree,
      authorName,
      authorUrl,
      publisherName,
      publisherUrl,
    };
  }

  return null;
}

function findJsonLdArticle(doc: Document): JsonLdArticle | null {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of Array.from(scripts)) {
    const text = script.textContent;
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      const article = findArticleInJson(parsed);
      if (article) {
        return article;
      }
    } catch {
      // ignore parse errors
    }
  }
  return null;
}

function cleanUrl(raw: string, base?: string): string {
  try {
    const u = base ? new URL(raw, base) : new URL(raw);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return raw.split("?")[0]!.split("#")[0]!;
  }
}

function collapseWhitespace(str: string): string {
  return str.replace(/\s+/g, " ").trim();
}

function cleanElement(element: Element): void {
  for (const selector of SELECTORS_TO_REMOVE) {
    const matches = element.querySelectorAll(selector);
    for (const el of Array.from(matches)) {
      el.remove();
    }
  }
}

function stripTitleHeading(markdown: string, title: string): string {
  const trimmed = markdown.trim();
  if (!trimmed || !title) {
    return markdown;
  }
  const lines = trimmed.split("\n");
  const firstLine = lines[0]?.trim();
  if (firstLine && firstLine.startsWith("#")) {
    const headingText = firstLine
      .replace(/^#+\s*/, "")
      .trim()
      .toLowerCase();
    const titleText = title.trim().toLowerCase();
    if (headingText === titleText) {
      lines.shift();
      while (lines.length > 0 && lines[0]?.trim() === "") {
        lines.shift();
      }
      const remaining = lines.join("\n").trim();
      return remaining ? `${remaining}\n` : "";
    }
  }
  return markdown;
}

export function extractSubstack(doc: Document, pageUrl: string): SubstackExtractResult {
  // The post data Substack embeds in the page is the most reliable source; the DOM is the fallback.
  const preloads = findSubstackPreloads(doc);
  if (preloads) {
    const fromPreloads = substackPostFromPreloads(preloads, pageUrl, doc);
    if (fromPreloads) return fromPreloads;
  }

  const jsonLd = findJsonLdArticle(doc);

  const hasPostBody = Boolean(
    doc.querySelector(".body.markup") || doc.querySelector(".available-content") || jsonLd !== null,
  );

  if (!isSubstackPlatform(doc, pageUrl) || !hasPostBody) {
    return { status: "not_substack" };
  }

  // 3. Metadata with fallbacks
  const rawUrl =
    doc.querySelector('link[rel="canonical"]')?.getAttribute("href") || jsonLd?.url || pageUrl;
  const url = cleanUrl(rawUrl, pageUrl);

  const rawTitle =
    doc.querySelector("h1.post-title")?.textContent ||
    jsonLd?.headline ||
    doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
    doc.title ||
    "";
  const title = collapseWhitespace(rawTitle);

  const rawSubtitle =
    doc.querySelector("h3.subtitle")?.textContent ||
    jsonLd?.description ||
    doc.querySelector('meta[name="description"]')?.getAttribute("content") ||
    null;
  const subtitle = rawSubtitle ? collapseWhitespace(rawSubtitle) || null : null;

  let author: string | null = jsonLd?.authorName ? collapseWhitespace(jsonLd.authorName) : null;
  let authorUrl: string | null = jsonLd?.authorUrl ? jsonLd.authorUrl.trim() : null;
  if (!author) {
    const metaAuthor = doc.querySelector('meta[name="author"]')?.getAttribute("content");
    if (metaAuthor) {
      author = collapseWhitespace(metaAuthor);
      authorUrl = null;
    }
  }

  let publication: string | null = jsonLd?.publisherName
    ? collapseWhitespace(jsonLd.publisherName)
    : null;
  let publicationUrl: string | null = jsonLd?.publisherUrl ? jsonLd.publisherUrl.trim() : null;
  if (!publication) {
    const ogSite = doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content");
    if (ogSite) {
      publication = collapseWhitespace(ogSite);
    }
  }
  if (!publicationUrl) {
    try {
      const parsedUrl = new URL(url);
      publicationUrl = `${parsedUrl.origin}/`;
    } catch {
      publicationUrl = null;
    }
  }

  const rawPublished =
    jsonLd?.datePublished ||
    doc.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ||
    doc.querySelector("time[datetime]")?.getAttribute("datetime") ||
    null;

  let published: string | null = null;
  if (rawPublished) {
    const trimmed = rawPublished.trim();
    try {
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) {
        published = d.toISOString();
      } else {
        published = trimmed;
      }
    } catch {
      published = trimmed;
    }
  }

  // 4. Paywall
  const freeVal = jsonLd?.isAccessibleForFree;
  const paid = freeVal === false || freeVal === "false" || freeVal === "False";

  const hasPaywall = Boolean(
    doc.querySelector('.paywall, [data-testid="paywall"], .paywall-title, .paywall-cta'),
  );

  if (hasPaywall) {
    return { status: "paywalled", url, title };
  }

  const access: "free" | "paid" = paid ? "paid" : "free";

  // 5. Body
  let markdown = "";
  const bodyEl =
    doc.querySelector(".available-content .body.markup") ?? doc.querySelector(".body.markup");

  if (bodyEl) {
    // Same cleanup as the embedded post data: images kept, widgets dropped, footnotes as [^n].
    const candidate = substackBodyToMarkdown(bodyEl.innerHTML, title, doc);
    if (candidate.trim()) {
      markdown = candidate;
    }
  }

  if (!markdown.trim()) {
    try {
      const clonedDoc = doc.cloneNode(true) as unknown as Document;
      const reader = new Readability(clonedDoc);
      const parsed = reader.parse();
      if (parsed?.content) {
        const container = doc.createElement("div");
        container.innerHTML = parsed.content;
        cleanElement(container);
        const rawMd = htmlToMarkdown(container.innerHTML);
        const candidate = stripTitleHeading(rawMd, title);
        if (candidate.trim()) {
          markdown = candidate;
        }
      }
    } catch {
      // Readability fallback failed
    }
  }

  if (!markdown.trim()) {
    if (paid) {
      return { status: "paywalled", url, title };
    }
    throw new Error("Couldn't find the post text on this page.");
  }

  return {
    status: "ok",
    capture: {
      url,
      title,
      subtitle,
      author,
      authorUrl,
      publication,
      publicationUrl,
      published,
      access,
      markdown,
    },
  };
}
