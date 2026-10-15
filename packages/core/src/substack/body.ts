import { htmlToMarkdown } from "../html-to-markdown";

// Turns a Substack `body_html` into a clean Markdown body (see docs/FILE-FORMAT.md):
// images as Markdown image links with their captions, no widgets or share chrome, headings start
// at ##, footnotes as GFM footnotes.

const REMOVE_SELECTORS = [
  ".captioned-image-container",
  ".image-gallery-embed",
  ".image-link",
  "figure",
  "figcaption",
  "picture",
  "img",
  "svg",
  "button",
  ".subscription-widget-wrap",
  ".subscription-widget-wrap-editor",
  ".subscription-widget",
  ".subscribe-widget",
  ".button-wrapper",
  ".paywall-jump",
  ".poll-embed",
  ".install-substack-app-embed",
  ".community-chat",
  ".post-ufi",
  ".share-dialog",
  '[data-component-name="ButtonCreateButton"]',
  '[data-component-name="SubscribeWidgetToDOM"]',
  '[data-component-name="SubscribeWidget"]',
  '[data-component-name="PaywallToDOM"]',
  '[data-component-name="CaptionedButtonToDOM"]',
  '[data-component-name="InstallSubstackAppToDOM"]',
];

const IMAGE_TOKEN = (n: number) => `SFIMAGE${n}SFEND`;
const IMAGE_TOKEN_PATTERN = /SFIMAGE(\d+)SFEND/g;

const FOOTNOTE_REF = (n: string) => `SFFOOTNOTEREF${n}SFEND`;
const FOOTNOTE_REF_PATTERN = /SFFOOTNOTEREF([A-Za-z0-9-]+)SFEND/g;

function readDataAttrs(el: Element): Record<string, unknown> | null {
  const raw = el.getAttribute("data-attrs");
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function linkParagraph(doc: Document, text: string, href: string): Element {
  const p = doc.createElement("p");
  const a = doc.createElement("a");
  a.setAttribute("href", href);
  a.textContent = text;
  p.appendChild(a);
  return p;
}

function stringAttr(attrs: Record<string, unknown> | null, key: string): string | null {
  const value = attrs?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Embeds become a single link so the reader still knows what was there.
function replaceEmbeds(root: Element, doc: Document): void {
  for (const el of Array.from(
    root.querySelectorAll(".tweet, [data-component-name='Twitter2ToDOM']"),
  )) {
    const attrs = readDataAttrs(el);
    const url = stringAttr(attrs, "url") ?? el.querySelector("a[href]")?.getAttribute("href");
    if (url) el.replaceWith(linkParagraph(doc, "Post on X", url));
    else el.remove();
  }
  for (const el of Array.from(root.querySelectorAll(".youtube-wrap"))) {
    const id = stringAttr(readDataAttrs(el), "videoId");
    if (id)
      el.replaceWith(linkParagraph(doc, "YouTube video", `https://www.youtube.com/watch?v=${id}`));
    else el.remove();
  }
  for (const el of Array.from(root.querySelectorAll(".embedded-post-wrap, .digest-post-embed"))) {
    const attrs = readDataAttrs(el);
    const url = stringAttr(attrs, "url");
    const title = stringAttr(attrs, "title");
    if (url) el.replaceWith(linkParagraph(doc, title ?? url, url));
    else el.remove();
  }
  for (const el of Array.from(
    root.querySelectorAll(".native-video-embed, .native-audio-embed, .audio-embed, iframe"),
  )) {
    el.remove();
  }
}

function webUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // Keep the link intact inside Markdown's (…).
    return url
      .toString()
      .replace(
        /[()\s<>]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
      );
  } catch {
    return null;
  }
}

function escapeAlt(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([\\[\]])/g, "\\$1");
}

// The original upload (data-attrs `src`) rather than a resized CDN copy, like sbstck-dl.
function imageFrom(img: Element): string | null {
  const attrs = readDataAttrs(img);
  const alt = stringAttr(attrs, "alt") ?? img.getAttribute("alt")?.trim() ?? "";
  const url = webUrl(stringAttr(attrs, "src")) ?? webUrl(img.getAttribute("src"));
  return url ? `![${escapeAlt(alt)}](${url})` : null;
}

function captionOf(el: Element): string {
  const caption = el.querySelector("figcaption");
  if (!caption) return "";
  const text = oneLine(htmlToMarkdown(caption.innerHTML));
  return text ? `*${text}*` : "";
}

// Images become a token paragraph (the converter drops <img>), filled in after conversion so the
// converter can't escape the link.
function replaceImages(root: Element, doc: Document): string[] {
  const blocks: string[] = [];
  const swap = (el: Element, lines: string[]) => {
    const kept = lines.filter(Boolean);
    if (kept.length === 0) {
      el.remove();
      return;
    }
    const p = doc.createElement("p");
    p.textContent = IMAGE_TOKEN(blocks.length);
    blocks.push(kept.join("\n\n"));
    el.replaceWith(p);
  };

  for (const el of Array.from(root.querySelectorAll(".image-gallery-embed"))) {
    const gallery = readDataAttrs(el)?.gallery as
      { images?: { src?: unknown }[]; caption?: unknown } | undefined;
    const images = (gallery?.images ?? [])
      .map((image) => webUrl(typeof image.src === "string" ? image.src : null))
      .map((url) => (url ? `![](${url})` : ""));
    const caption = typeof gallery?.caption === "string" ? gallery.caption.trim() : "";
    swap(el, [...images, caption ? `*${caption.replace(/\s+/g, " ")}*` : ""]);
  }
  for (const el of Array.from(root.querySelectorAll(".captioned-image-container, figure"))) {
    if (!root.contains(el)) continue;
    const images = Array.from(el.querySelectorAll("img")).map(imageFrom);
    swap(el, [...images.map((i) => i ?? ""), captionOf(el)]);
  }
  for (const img of Array.from(root.querySelectorAll("img"))) {
    if (!root.contains(img)) continue;
    // Tracking pixels and icons aren't content.
    const width = Number(img.getAttribute("width"));
    if (width > 0 && width < 32) {
      img.remove();
      continue;
    }
    const target = img.closest("a.image-link, picture") ?? img;
    swap(target, [imageFrom(img) ?? ""]);
  }
  return blocks;
}

function renameHeading(el: Element, level: number, doc: Document): void {
  const next = doc.createElement(`h${level}`);
  while (el.firstChild) next.appendChild(el.firstChild);
  el.replaceWith(next);
}

// Body headings start at ##. Only shift when the post itself uses h1.
function demoteHeadings(root: Element, doc: Document): void {
  const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  if (!headings.some((h) => h.tagName.toLowerCase() === "h1")) return;
  for (const h of headings) {
    const level = Number(h.tagName.slice(1));
    renameHeading(h, Math.min(level + 1, 6), doc);
  }
}

function removeLeadingTitle(root: Element, title: string): void {
  const first = root.firstElementChild;
  if (!first || !/^h[1-6]$/i.test(first.tagName)) return;
  const text = (first.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (text && text === title.replace(/\s+/g, " ").trim().toLowerCase()) first.remove();
}

function oneLine(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

// Substack footnotes: <a class="footnote-anchor" href="#footnote-1">1</a> in the text and
// <div class="footnote"><a class="footnote-number">1</a><div class="footnote-content">…</div></div>.
function extractFootnotes(root: Element, doc: Document): string[] {
  for (const anchor of Array.from(root.querySelectorAll("a.footnote-anchor"))) {
    const label = (anchor.textContent ?? "").trim();
    if (label) anchor.replaceWith(doc.createTextNode(FOOTNOTE_REF(label)));
    else anchor.remove();
  }

  const definitions: string[] = [];
  for (const note of Array.from(root.querySelectorAll("div.footnote"))) {
    const label = (note.querySelector(".footnote-number")?.textContent ?? "").trim();
    const content = note.querySelector(".footnote-content");
    note.remove();
    if (!label || !content) continue;
    const text = oneLine(htmlToMarkdown(content.innerHTML)).replace(
      FOOTNOTE_REF_PATTERN,
      (_m, n: string) => `[^${n}]`,
    );
    if (text) definitions.push(`[^${label}]: ${text}`);
  }
  return definitions;
}

function tidy(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Converts Substack post HTML to the Markdown body. `doc` is any Document used to build nodes. */
export function substackBodyToMarkdown(bodyHtml: string, title: string, doc: Document): string {
  const root = doc.createElement("div");
  root.innerHTML = bodyHtml;

  const images = replaceImages(root, doc);
  for (const selector of REMOVE_SELECTORS) {
    for (const el of Array.from(root.querySelectorAll(selector))) el.remove();
  }
  replaceEmbeds(root, doc);

  const definitions = extractFootnotes(root, doc);
  removeLeadingTitle(root, title);
  demoteHeadings(root, doc);

  let body = tidy(htmlToMarkdown(root.innerHTML))
    .replace(FOOTNOTE_REF_PATTERN, (_m, n: string) => `[^${n}]`)
    .replace(IMAGE_TOKEN_PATTERN, (_m, n: string) => images[Number(n)] ?? "");
  if (definitions.length > 0) {
    body = `${body}\n\n${definitions.join("\n")}`;
  }
  body = tidy(body);
  return body ? `${body}\n` : "";
}
