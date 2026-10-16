import type { SourceCapture } from "../capture-types";
import { SourceError } from "../source-fetch";

// Turns arXiv's HTML version of a paper (https://arxiv.org/html/<id>, LaTeXML output) into the
// body described in docs/FILE-FORMAT.md. It works on a Document, so it runs on the server
// (linkedom) and in the desktop webview (DOMParser).
//
// Choices:
// - The abstract becomes `## Abstract`; each section becomes `##` (`###` for a subsection) and
//   keeps its number, so `1 Introduction` stays recognizable.
// - Math uses the `<math alttext>` LaTeX: `$…$` inline, `$$` on its own lines for `display="block"`.
// - Figures become `![alt](absolute src)` with the caption in italics below.
// - Citations stay as plain text; the bibliography becomes a list under `## References`.
// - Tables are dropped (LaTeXML's layout tables carry no readable text). Navigation, footers and
//   the "Report issue" chrome live outside the article and are left out by scoping to it.

// LaTeXML writes image `src` values relative to arXiv's HTML root (`<id><version>/Figures/…`),
// and no `<base>` element is present, so resolve against the HTML root rather than the paper page.
const HTML_ROOT = "https://arxiv.org/html/";

const DROP_SELECTORS = [
  "script",
  "style",
  "link",
  "meta",
  "noscript",
  "template",
  "button",
  "svg",
  "nav",
  "header",
  "footer",
  ".ltx_page_navbar",
  ".ltx_page_footer",
  ".ltx_page_logo",
  ".arxiv-html-footer",
  ".ltx_TOC",
  ".ltx_navbar",
  ".ltx_report_issue",
  ".ltx_role_note",
  ".ltx_author_notes",
  // Footnote and margin-note markers: their text is an affiliation or a placement note and reads
  // as noise inline, so both the mark and its content are dropped.
  ".ltx_note",
  ".ltx_role_footnotemark",
  "#watermark-tr",
  "[hidden]",
];

const SECTION_LEVELS: ReadonlyArray<readonly [string, number]> = [
  ["ltx_section", 2],
  ["ltx_subsection", 3],
  ["ltx_subsubsection", 4],
  ["ltx_paragraph", 5],
  ["ltx_subparagraph", 6],
];

/**
 * Converts arXiv's HTML paper into a capture. `url` is the abstract page and `meta.arxiv` is the
 * id, so a saved paper and its PDF link resolve to the same item.
 */
export function arxivHtmlToCapture(
  html: string,
  arxivId: string,
  parseHtml: (html: string) => Document,
): SourceCapture {
  let doc: Document;
  try {
    doc = parseHtml(html);
  } catch {
    throw new SourceError("parse_failed", "Couldn't read this paper.");
  }

  const article =
    doc.querySelector("article.ltx_document") ??
    doc.querySelector("article") ??
    doc.querySelector(".ltx_page_content") ??
    doc.body;
  if (!article) throw new SourceError("parse_failed", "Couldn't read this paper.");

  for (const selector of DROP_SELECTORS) {
    for (const el of Array.from(article.querySelectorAll(selector))) el.remove();
  }

  const title = collapseText(
    doc.querySelector("h1.ltx_title_document")?.textContent ??
      doc.querySelector("h1.ltx_title")?.textContent ??
      "",
  );
  if (!title) throw new SourceError("parse_failed", "Couldn't read this paper.");

  const author = readAuthors(article);

  const blocks: string[] = [];
  renderBlocks(article, HTML_ROOT, blocks);
  const markdown = blocks
    .filter((block) => block.trim())
    .join("\n\n")
    .trim();

  return {
    url: `https://arxiv.org/abs/${arxivId}`,
    title: title.slice(0, 500),
    meta: {
      author: author || null,
      published: null,
      pages: null,
      arxiv: arxivId,
    },
    markdown,
  };
}

function readAuthors(root: Element): string {
  const names = new Set<string>();
  const people = root.querySelectorAll(".ltx_personname");
  const creators = people.length > 0 ? people : root.querySelectorAll(".ltx_creator");
  for (const person of Array.from(creators)) {
    const name = collapseText(person.textContent ?? "");
    if (name) names.add(name);
  }
  return Array.from(names).join(", ");
}

function renderBlocks(root: Element, base: string, out: string[]): void {
  for (const child of Array.from(root.children)) {
    if (isTitleHeading(child)) continue;
    if (hasClass(child, "ltx_abstract")) {
      renderAbstract(child, base, out);
      continue;
    }
    if (hasClass(child, "ltx_bibliography") || child.id === "bib") {
      renderReferences(child, base, out);
      continue;
    }
    if (isSection(child)) {
      renderSection(child, base, out);
      continue;
    }
    if (child.tagName === "FIGURE") {
      if (hasClass(child, "ltx_figure")) {
        const block = figureBlock(child, base);
        if (block) out.push(block);
      }
      continue;
    }
    if (child.tagName === "TABLE") {
      out.push(...equationBlocks(child));
      continue;
    }
    if (child.tagName === "P") {
      const text = paragraph(child, base);
      if (text) out.push(text);
      continue;
    }
    if (child.tagName === "UL" || child.tagName === "OL") {
      renderList(child, base, out);
      continue;
    }
    renderBlocks(child, base, out);
  }
}

function renderAbstract(root: Element, base: string, out: string[]): void {
  const paragraphs: string[] = [];
  for (const p of Array.from(root.querySelectorAll("p, .ltx_para"))) {
    if (p.tagName === "DIV" && p.querySelector("p")) continue;
    const text = paragraph(p, base);
    if (text) paragraphs.push(text);
  }
  if (paragraphs.length === 0) {
    const text = paragraph(root, base);
    if (text) paragraphs.push(text);
  }
  if (paragraphs.length > 0) out.push("## Abstract", ...paragraphs);
}

function renderSection(root: Element, base: string, out: string[]): void {
  const level = sectionLevel(root);
  const heading = collapseText(root.querySelector("h1,h2,h3,h4,h5,h6")?.textContent ?? "");
  if (heading) out.push(`${"#".repeat(level)} ${heading}`);
  renderBlocks(root, base, out);
}

function renderReferences(root: Element, base: string, out: string[]): void {
  const items: string[] = [];
  for (const item of Array.from(root.querySelectorAll("li.ltx_bibitem"))) {
    const tag = item.querySelector(".ltx_tag_bibitem");
    const label = tag ? collapseText(tag.textContent ?? "") : "";
    tag?.remove();
    const text = paragraph(item, base);
    if (text) items.push(`- ${label ? `${label} ` : ""}${text}`);
  }
  if (items.length > 0) out.push("## References", items.join("\n"));
}

function renderList(root: Element, base: string, out: string[]): void {
  const items: string[] = [];
  for (const item of Array.from(root.children)) {
    if (item.tagName !== "LI") continue;
    const text = paragraph(item, base);
    if (text) items.push(`- ${text}`);
  }
  if (items.length > 0) out.push(items.join("\n"));
}

// ---------------------------------------------------------------------------------------------
// Inline Markdown

function paragraph(node: Element, base: string): string {
  return tidy(inline(node, base));
}

function inline(node: Node, base: string): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      out += (child.textContent ?? "").replace(/\s+/g, " ");
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const tag = el.tagName;

    if (tag === "MATH") {
      const alt = (el.getAttribute("alttext") ?? "").trim();
      if (alt) out += `$${alt}$`;
      continue;
    }
    if (tag === "CITE") {
      out += inline(el, base);
      continue;
    }
    if (tag === "A") {
      const href = el.getAttribute("href") ?? "";
      const text = inline(el, base);
      if (!href || href.startsWith("#")) {
        out += text;
        continue;
      }
      const url = absoluteUrl(href, base);
      out += url ? `[${tidy(text)}](${url})` : text;
      continue;
    }
    if (tag === "IMG" || tag === "OBJECT") {
      const src = imageSource(el, base);
      if (src) out += `![${(el.getAttribute("alt") ?? "").trim()}](${src})`;
      continue;
    }
    if (tag === "BR") {
      out += " ";
      continue;
    }
    if (tag === "CODE") {
      const text = collapseText(el.textContent ?? "");
      if (text) out += `\`${text}\``;
      continue;
    }
    if (hasClass(el, "ltx_role_affiliation") || hasClass(el, "ltx_role_note")) continue;
    if (isItalic(el)) {
      const text = tidy(inline(el, base));
      if (text) out += `*${text}*`;
      continue;
    }
    if (isBold(el)) {
      const text = tidy(inline(el, base));
      if (text) out += `**${text}**`;
      continue;
    }
    out += inline(el, base);
  }
  return out;
}

function isItalic(el: Element): boolean {
  return el.tagName === "EM" || el.tagName === "I" || hasClass(el, "ltx_font_italic");
}

function isBold(el: Element): boolean {
  return el.tagName === "STRONG" || el.tagName === "B" || hasClass(el, "ltx_font_bold");
}

// ---------------------------------------------------------------------------------------------
// Figures, math and helpers

function figureBlock(figure: Element, base: string): string {
  const captionEl = figure.querySelector("figcaption, .ltx_caption");
  const caption = captionEl ? collapseText(captionEl.textContent ?? "") : "";
  const captionText = stripFigureTag(caption);

  const images: string[] = [];
  for (const media of Array.from(figure.querySelectorAll("img, object"))) {
    const src = imageSource(media, base);
    if (!src) continue;
    const alt = (media.getAttribute("alt") ?? "").trim();
    const label = !alt || /^refer to caption$/i.test(alt) ? captionText : alt;
    images.push(`![${label}](${src})`);
  }

  const parts = [...images];
  if (captionText) parts.push(`*${captionText}*`);
  return parts.join("\n\n");
}

/** Drops the leading `Figure 1: ` label LaTeXML puts inside the caption. */
function stripFigureTag(caption: string): string {
  return caption.replace(/^(Figure|Table)\s+\d+[a-z]?\s*:\s*/i, "").trim();
}

function equationBlocks(table: Element): string[] {
  const blocks: string[] = [];
  for (const math of Array.from(table.querySelectorAll('math[alttext][display="block"]'))) {
    const alt = (math.getAttribute("alttext") ?? "").trim();
    if (alt) blocks.push(`$$\n${alt}\n$$`);
  }
  if (blocks.length === 0) {
    // A block equation that LaTeXML marked inline; keep it rather than lose the formula.
    for (const math of Array.from(table.querySelectorAll("math[alttext]"))) {
      const alt = (math.getAttribute("alttext") ?? "").trim();
      if (alt.length > 1) blocks.push(`$$\n${alt}\n$$`);
    }
  }
  return blocks;
}

function imageSource(el: Element, base: string): string | null {
  const raw = el.tagName === "OBJECT" ? el.getAttribute("data") : el.getAttribute("src");
  return raw ? absoluteUrl(raw, base) : null;
}

function absoluteUrl(href: string, base: string): string | null {
  const value = href.trim();
  if (!value || value.startsWith("data:") || value.startsWith("javascript:")) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

function isSection(el: Element): boolean {
  return SECTION_LEVELS.some(([cls]) => hasClass(el, cls));
}

function sectionLevel(el: Element): number {
  for (const [cls, level] of SECTION_LEVELS) {
    if (hasClass(el, cls)) return level;
  }
  return 2;
}

function isTitleHeading(el: Element): boolean {
  return /^H[1-6]$/.test(el.tagName) && hasClass(el, "ltx_title");
}

function hasClass(el: Element, name: string): boolean {
  return (el.getAttribute("class") ?? "").split(/\s+/).includes(name);
}

function collapseText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Collapses whitespace and closes the gaps LaTeXML leaves around inline math and punctuation. */
function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?)\]])/g, "$1")
    .replace(/([([])\s+/g, "$1")
    .trim();
}
