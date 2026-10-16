import Defuddle from "defuddle";
import TurndownService from "turndown";
import { tables, strikethrough } from "@joplin/turndown-plugin-gfm";
import type { SourceCapture } from "../capture-types";

// "Any web page": defuddle (kepano/defuddle, MIT) finds the main content of a page, then the
// shared Turndown setup turns that content into Markdown. defuddle runs on the document the
// caller parses, so the same code works with linkedom on the server and DOMParser in a browser.

/** Below this much visible text a page has no article to save. */
export const MIN_WEB_PAGE_TEXT_LENGTH = 100;

function firstNonEmpty(values: (string | null | undefined)[]): string {
  for (const value of values) {
    const trimmed = value?.replace(/\s+/g, " ").trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Normalizes defuddle's `published` to `YYYY-MM-DD`, or null when it isn't a date. */
export function normalizeWebPageDate(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const direct = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  // Keep the day the page itself names: a value with a timezone is read in UTC, one without in
  // local time (so "March 4, 2026" stays the 4th in every timezone).
  const withTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const year = withTimeZone ? parsed.getUTCFullYear() : parsed.getFullYear();
  const month = (withTimeZone ? parsed.getUTCMonth() : parsed.getMonth()) + 1;
  const day = withTimeZone ? parsed.getUTCDate() : parsed.getDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Characters of readable text in a Markdown body, with image and link markup ignored. */
export function webPageTextLength(markdown: string): number {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

const DANGEROUS_URL = /^(?:javascript|data|blob|vbscript):/i;

function isDangerousUrl(value: string): boolean {
  return DANGEROUS_URL.test(value.replace(/[\s\u0000-\u001f]+/g, ""));
}

function absoluteUrl(value: string, baseUrl: string): string | null {
  if (!value) return null;
  if (value.startsWith("#")) return value;
  if (isDangerousUrl(value)) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Wraps a URL in angle brackets when it contains characters that would break the Markdown. */
function markdownUrl(url: string): string {
  return /[\s()<>]/.test(url) ? `<${url}>` : url;
}

/** Escapes the characters that would otherwise change meaning inside alt text or a caption. */
function escapeText(text: string): string {
  return text.replace(/([\\[\]*_`])/g, "\\$1");
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function imageMarkdown(image: Element, baseUrl: string): string {
  const url = absoluteUrl(image.getAttribute("src") ?? "", baseUrl);
  if (!url) return "";
  const alt = escapeText(cleanText(image.getAttribute("alt")));
  return `![${alt}](${markdownUrl(url)})`;
}

function firstImage(node: Element): Element | null {
  return node.getElementsByTagName("img")[0] ?? null;
}

function createConverter(baseUrl: string, shiftHeadings: boolean): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });

  service.use([tables, strikethrough]);

  const tagsToRemove = [
    "script",
    "style",
    "noscript",
    "svg",
    "button",
    "img",
    "picture",
    "video",
    "audio",
    "iframe",
    "form",
    "input",
  ] as (keyof HTMLElementTagNameMap)[];

  service.remove(tagsToRemove);
  service.addRule("removeDisallowedTags", { filter: tagsToRemove, replacement: () => "" });

  // A figure becomes its picture, then the caption in italics. Its children are handled here,
  // so the img/picture removal below never sees them.
  service.addRule("webFigure", {
    filter: (node) => node.nodeName === "FIGURE" && firstImage(node) !== null,
    replacement: (_content, node) => {
      const image = firstImage(node);
      const picture = image ? imageMarkdown(image, baseUrl) : "";
      if (!picture) return "";
      const caption = cleanText(node.getElementsByTagName("figcaption")[0]?.textContent);
      const block = caption ? `${picture}\n\n*${escapeText(caption)}*` : picture;
      return `\n\n${block}\n\n`;
    },
  });

  service.addRule("webPicture", {
    filter: "picture",
    replacement: (_content, node) => {
      const image = firstImage(node);
      return image ? imageMarkdown(image, baseUrl) : "";
    },
  });

  service.addRule("webImage", {
    filter: "img",
    replacement: (_content, node) => imageMarkdown(node, baseUrl),
  });

  service.addRule("webLink", {
    filter: (node) => node.nodeName === "A" && node.getAttribute("href") !== null,
    replacement: (content, node) => {
      const text = content.trim();
      if (!text) return "";
      const url = absoluteUrl(node.getAttribute("href") ?? "", baseUrl);
      if (!url) return text;
      return `[${text}](${markdownUrl(url)})`;
    },
  });

  // Headings start at ##. defuddle already turns an h1 into an h2, so shift down only when the
  // content still carries an h1 of its own, keeping the page's own levels intact.
  const headingTags = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
  for (const tag of headingTags) {
    const number = Number(tag.slice(1));
    service.addRule(`web${tag}`, {
      filter: tag,
      replacement: (content) => {
        const text = content.trim();
        if (!text) return "";
        const level = Math.min(6, shiftHeadings ? number + 1 : number);
        return `\n\n${"#".repeat(level)} ${text}\n\n`;
      },
    });
  }

  return service;
}

function tidy(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeHeading(text: string): string {
  return text
    .replace(/\\/g, "")
    .replace(/[`*_[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Drops a first heading that only repeats the title (defuddle usually removes it already). */
function dropLeadingTitleHeading(markdown: string, title: string): string {
  const lines = markdown.split("\n");
  let index = 0;
  while (index < lines.length && !lines[index]!.trim()) index++;
  const match = /^#{2,6}\s+(.+)$/.exec(lines[index] ?? "");
  if (!match || !title || normalizeHeading(match[1]!) !== normalizeHeading(title)) {
    return markdown;
  }
  let after = index + 1;
  while (after < lines.length && !lines[after]!.trim()) after++;
  return lines.slice(after).join("\n").trim();
}

function contentToMarkdown(contentHtml: string, baseUrl: string, title: string): string {
  if (!contentHtml.trim()) return "";
  const converter = createConverter(baseUrl, /<h1[\s>]/i.test(contentHtml));
  const markdown = tidy(converter.turndown(contentHtml));
  const body = dropLeadingTitleHeading(markdown, title);
  return body ? `${body}\n` : "";
}

/**
 * Turns an already-parsed page into a `web` capture. Runs defuddle (kepano/defuddle) on `html`
 * to find the main content and its metadata, then converts that content with Turndown.
 */
export function webPageToCapture(
  html: string,
  url: string,
  parseHtml: (html: string) => Document,
): SourceCapture {
  const doc = parseHtml(html);
  const documentTitle = cleanText(doc.querySelector("title")?.textContent);

  const result = new Defuddle(doc, { url, useAsync: false }).parse();

  const title = firstNonEmpty([result.title, documentTitle, hostOf(url)]);

  return {
    url,
    title,
    meta: {
      site: cleanText(result.site) || null,
      author: cleanText(result.author) || null,
      published: normalizeWebPageDate(result.published),
      summary: cleanText(result.description) || null,
    },
    markdown: contentToMarkdown(result.content, url, title),
  };
}
