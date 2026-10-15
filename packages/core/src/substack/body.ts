import { htmlToMarkdown } from "../html-to-markdown";

// Turns a Substack `body_html` into a clean Markdown body (see docs/FILE-FORMAT.md):
// no images, widgets or share chrome, headings start at ##, footnotes as GFM footnotes.

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

  for (const selector of REMOVE_SELECTORS) {
    for (const el of Array.from(root.querySelectorAll(selector))) el.remove();
  }
  replaceEmbeds(root, doc);

  const definitions = extractFootnotes(root, doc);
  removeLeadingTitle(root, title);
  demoteHeadings(root, doc);

  let body = tidy(htmlToMarkdown(root.innerHTML)).replace(
    FOOTNOTE_REF_PATTERN,
    (_m, n: string) => `[^${n}]`,
  );
  if (definitions.length > 0) {
    body = `${body}\n\n${definitions.join("\n")}`;
  }
  body = tidy(body);
  return body ? `${body}\n` : "";
}
