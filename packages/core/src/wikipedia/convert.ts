import { htmlToMarkdown } from "../html-to-markdown";

// Turns the Wikimedia REST page HTML (Parsoid output) of an article into the Markdown body
// described in docs/FILE-FORMAT.md. It works on a Document, so it runs on the server (linkedom)
// and in the desktop webview (DOMParser).
//
// Choices:
// - Headings start at ##. Hatnotes, navboxes, sidebars, maintenance banners, "citation needed"
//   tags, coordinates, edit links, the table of contents and hidden text are dropped.
// - The infobox becomes a compact two-column table (`| Field | Value |`) right after the lead
//   paragraph, preceded by its picture. Rows without a label (headers, captions, nested boxes)
//   are dropped, and so is the whole infobox if no row has both a label and a value.
// - References become GFM footnotes, numbered by first use and shared when a source is cited
//   again, listed under `## References`.
// - Pictures become `![alt](full-size url)` followed by `*caption*`; icons and flags under 40px
//   are skipped. Math keeps its LaTeX: `$…$` inline, `$$…$$` as its own block.
// - Simple tables become GFM tables. A table with merged cells, nested tables or ragged rows keeps
//   its text as one bullet per row.

export interface WikipediaConvertOptions {
  /** Language edition, used to make links to other articles absolute. */
  language: string;
}

const MIN_IMAGE_SIZE = 40;

// Zero-width space (U+200B) and soft hyphen (U+00AD), which templates and long words carry.
const INVISIBLE = new RegExp(`[${String.fromCharCode(0x200b, 0xad)}]`, "g");

const REMOVE_SELECTORS = [
  "script",
  "style",
  "link",
  "meta",
  "base",
  "noscript",
  "template",
  "audio",
  "video",
  "iframe",
  "svg",
  ".shortdescription",
  ".hatnote",
  ".dablink",
  ".rellink",
  ".mw-empty-elt",
  ".navbox",
  ".navbox-styles",
  ".vertical-navbox",
  ".sidebar",
  ".succession-box",
  ".authority-control",
  ".catlinks",
  ".portal-bar",
  ".portalbox",
  ".sister-box",
  ".sistersitebox",
  ".side-box",
  ".metadata",
  ".ambox",
  ".tmbox",
  ".cmbox",
  ".ombox",
  ".fmbox",
  ".imbox",
  ".asbox",
  ".stub",
  ".mw-editsection",
  ".mw-indicators",
  ".noprint",
  ".printfooter",
  ".toc",
  "#toc",
  ".mw-toc",
  ".geo-inline",
  ".geo-inline-hidden",
  ".geo-default",
  ".geo-nondefault",
  ".geo-multi-punct",
  ".geo",
  "#coordinates",
  ".Inline-Template",
  ".Template-Fact",
  ".sortkey",
  ".sr-only",
  ".Z3988",
  ".cs1-maint",
  ".cs1-hidden-error",
  ".cs1-visible-error",
  ".mw-cite-backlink",
  ".reference-accessdate",
  "[hidden]",
  '[style*="display:none"]',
  '[style*="display: none"]',
  '[typeof~="mw:Error"]',
  '[typeof~="mw:Extension/templatestyles"]',
  '[typeof~="mw:Extension/toc"]',
];

const REFERENCE_LIST_SELECTORS = [
  ".mw-references-wrap",
  "ol.references",
  ".reflist",
  "div.references-small",
  '[typeof~="mw:Extension/references"]',
];

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "−": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
};

const SUBSCRIPT: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "−": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  a: "ₐ",
  e: "ₑ",
  h: "ₕ",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  l: "ₗ",
  m: "ₘ",
  n: "ₙ",
  o: "ₒ",
  p: "ₚ",
  r: "ᵣ",
  s: "ₛ",
  t: "ₜ",
  u: "ᵤ",
  v: "ᵥ",
  x: "ₓ",
};

interface Context {
  doc: Document;
  language: string;
  base: string;
  /** Raw Markdown for tokens left in the HTML (the converter would otherwise escape it). */
  tokens: string[];
  /** Footnote definitions in numbered order: `[^n]: text`. */
  definitions: string[];
}

const TOKEN_PATTERN = /SFWP(\d+)SFEND/g;
const FOOTNOTE_PATTERN = /SFWPREF(\d+)SFEND/g;

function token(ctx: Context, markdown: string): string {
  ctx.tokens.push(markdown);
  return `SFWP${ctx.tokens.length - 1}SFEND`;
}

function footnoteToken(n: number): string {
  return `SFWPREF${n}SFEND`;
}

function oneLine(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function attrNumber(el: Element, name: string): number {
  const value = Number(el.getAttribute(name));
  return Number.isFinite(value) ? value : 0;
}

function hasClass(el: Element, name: string): boolean {
  return (el.getAttribute("class") ?? "").split(/\s+/).includes(name);
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  el.remove();
}

function removeAll(root: Element, selector: string): void {
  for (const el of Array.from(root.querySelectorAll(selector))) el.remove();
}

function makeParagraph(doc: Document, text: string): Element {
  const p = doc.createElement("p");
  p.textContent = text;
  return p;
}

// Keeps a URL intact inside Markdown's (…).
function safeUrl(url: string): string {
  return url.replace(
    /[()\s<>]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

function escapeAlt(text: string): string {
  return collapse(text).replace(/([\\[\]])/g, "\\$1");
}

// --- Links -----------------------------------------------------------------

function normalizeLinks(root: Element, ctx: Context): void {
  for (const a of Array.from(root.querySelectorAll("a"))) {
    a.removeAttribute("title");
    // Empty links are icons (audio players, external-link marks) that were dropped with their image.
    if (!collapse(a.textContent ?? "") && !a.querySelector("img")) {
      a.remove();
      continue;
    }
    const href = (a.getAttribute("href") ?? "").trim();
    if (!href || href.startsWith("#") || hasClass(a, "new")) {
      unwrap(a);
      continue;
    }
    let url: URL;
    try {
      url = new URL(href, ctx.base);
    } catch {
      unwrap(a);
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      unwrap(a);
      continue;
    }
    if (url.searchParams.get("redlink") === "1") {
      unwrap(a);
      continue;
    }
    // Links to a picture's page or a category add nothing to the text.
    if (
      /^\/wiki\/(?:File|Image|Category|Special|Media):/i.test(url.pathname) &&
      !a.querySelector("img")
    ) {
      unwrap(a);
      continue;
    }
    a.setAttribute("href", safeUrl(url.toString()));
  }
}

// --- Math ------------------------------------------------------------------

function texOf(el: Element): string {
  const math = el.querySelector("math");
  let tex = math?.getAttribute("alttext") ?? "";
  if (!tex) tex = el.querySelector("img")?.getAttribute("alt") ?? "";
  tex = tex.trim();
  const wrapped = /^\{\\(?:display|text|script|scriptscript)style\s*([\s\S]*)\}$/.exec(tex);
  if (wrapped?.[1] !== undefined) tex = wrapped[1];
  return tex.replace(/\s+/g, " ").trim();
}

function replaceMath(root: Element, ctx: Context): void {
  for (const el of Array.from(root.querySelectorAll(".mwe-math-element"))) {
    if (!root.contains(el) || el.parentElement?.closest(".mwe-math-element")) continue;
    let tex = texOf(el);
    if (!tex) {
      el.remove();
      continue;
    }
    const inCell = Boolean(el.closest("td, th"));
    if (inCell) tex = tex.replace(/\|/g, "\\vert ");
    const display =
      hasClass(el, "mwe-math-element-block") ||
      el.querySelector("math")?.getAttribute("display") === "block";
    if (display && !inCell) {
      el.replaceWith(makeParagraph(ctx.doc, token(ctx, `$$\n${tex}\n$$`)));
    } else {
      el.replaceWith(ctx.doc.createTextNode(token(ctx, `$${tex}$`)));
    }
  }
}

// --- Superscripts and subscripts -------------------------------------------

function mapAll(text: string, table: Record<string, string>): string | null {
  let out = "";
  for (const ch of text) {
    const mapped = table[ch];
    if (mapped === undefined) return null;
    out += mapped;
  }
  return out;
}

function replaceScripts(root: Element, ctx: Context): void {
  for (const el of Array.from(root.querySelectorAll("sup, sub"))) {
    if (hasClass(el, "reference") || hasClass(el, "mw-ref")) continue;
    if (el.querySelector("a")) {
      unwrap(el);
      continue;
    }
    const text = collapse(el.textContent ?? "");
    const isSup = el.tagName.toLowerCase() === "sup";
    let replacement = text;
    // Ordinals like 1st and 20th stay plain; everything else becomes Unicode where it can.
    const plainWord = isSup && /^[A-Za-zÀ-ÿ]+$/.test(text);
    if (text && !plainWord) {
      const mapped = mapAll(text, isSup ? SUPERSCRIPT : SUBSCRIPT);
      const isWord = /^[A-Za-zÀ-ÿ]+$/.test(text);
      replacement = mapped ?? (isWord ? text : isSup ? `^(${text})` : `_(${text})`);
    }
    el.replaceWith(ctx.doc.createTextNode(replacement));
  }
}

// --- References ------------------------------------------------------------

function fragmentOf(href: string): string | null {
  const hash = href.indexOf("#");
  if (hash === -1) return null;
  const raw = href.slice(hash + 1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function referenceText(li: Element): string {
  const body = li.querySelector(".mw-reference-text, .reference-text") ?? li;
  const clone = body.cloneNode(true) as Element;
  removeAll(clone, "img, figure, style, .mw-cite-backlink, sup.mw-ref, sup.reference");
  return oneLine(htmlToMarkdown(clone.innerHTML));
}

function extractReferences(root: Element, ctx: Context): void {
  const entries = new Map<string, Element>();
  for (const li of Array.from(
    root.querySelectorAll('li[id^="cite_note"], .references li[id], .mw-references li[id]'),
  )) {
    const id = li.getAttribute("id");
    if (id) entries.set(id, li);
  }

  const numbers = new Map<string, number>();
  const markers = Array.from(root.querySelectorAll("sup.mw-ref, sup.reference"));
  for (const sup of markers) {
    if (sup.closest("ol.references, .reflist, .mw-references-wrap")) continue;
    const href = sup.querySelector("a[href*='#cite_note']")?.getAttribute("href") ?? "";
    const key = fragmentOf(href);
    const li = key ? entries.get(key) : undefined;
    if (!key || !li) {
      sup.remove();
      continue;
    }
    let number = numbers.get(key);
    if (number === undefined) {
      const text = referenceText(li);
      if (!text) {
        sup.remove();
        continue;
      }
      number = numbers.size + 1;
      numbers.set(key, number);
      ctx.definitions.push(`[^${number}]: ${text}`);
    }
    sup.replaceWith(ctx.doc.createTextNode(footnoteToken(number)));
  }

  for (const selector of REFERENCE_LIST_SELECTORS) removeAll(root, selector);
}

// --- Images ----------------------------------------------------------------

const KEEP_ORIGINAL = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg"]);
const THUMB_PATH =
  /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/(wikipedia\/[^/]+)\/thumb\/((?:archive\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+))\/[^/]+$/;

/** The full-size file behind a thumbnail address. Files a browser can't show keep the thumbnail. */
export function wikipediaFullSizeImageUrl(src: string): string | null {
  const trimmed = src.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const bare = `https://${url.host}${url.pathname}`;
  const match = THUMB_PATH.exec(bare);
  if (!match) return safeUrl(bare);
  const extension = (match[3] ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (KEEP_ORIGINAL.has(extension)) {
    return safeUrl(`https://upload.wikimedia.org/${match[1]}/${match[2]}`);
  }
  return safeUrl(`https://upload.wikimedia.org${url.pathname}`);
}

function imageMarkdown(img: Element): string | null {
  const width = attrNumber(img, "width");
  const height = attrNumber(img, "height");
  if ((width > 0 && width < MIN_IMAGE_SIZE) || (height > 0 && height < MIN_IMAGE_SIZE)) {
    return null;
  }
  const url = wikipediaFullSizeImageUrl(img.getAttribute("src") ?? "");
  if (!url) return null;
  return `![${escapeAlt(img.getAttribute("alt") ?? "")}](${url})`;
}

function captionMarkdown(el: Element | null): string {
  if (!el) return "";
  const clone = el.cloneNode(true) as Element;
  removeAll(clone, "img, figure, style, .magnify");
  // Emphasis inside an italic caption would end it early.
  for (const inner of Array.from(clone.querySelectorAll("i, em, b, strong"))) unwrap(inner);
  const text = oneLine(htmlToMarkdown(clone.innerHTML));
  return text ? `*${text}*` : "";
}

/** Replaces a picture container with one paragraph: each image, then the caption. */
function swapForImages(ctx: Context, el: Element, images: Element[], caption: string): void {
  const lines = images.map(imageMarkdown).filter((line): line is string => Boolean(line));
  if (lines.length === 0) {
    el.remove();
    return;
  }
  if (caption) lines.push(caption);
  el.replaceWith(makeParagraph(ctx.doc, token(ctx, lines.join("\n\n"))));
}

function replaceImages(root: Element, ctx: Context): void {
  // Galleries: one image and caption per box.
  for (const box of Array.from(root.querySelectorAll("li.gallerybox"))) {
    if (!root.contains(box)) continue;
    const images = Array.from(box.querySelectorAll("img"));
    swapForImages(ctx, box, images, captionMarkdown(box.querySelector(".gallerytext")));
  }
  for (const gallery of Array.from(root.querySelectorAll("ul.gallery"))) {
    if (!root.contains(gallery)) continue;
    // The boxes are paragraphs now; keep them as plain blocks.
    unwrap(gallery);
  }

  // Several pictures sharing one box: each with its own caption.
  for (const multi of Array.from(root.querySelectorAll(".tmulti"))) {
    if (!root.contains(multi)) continue;
    const parts = Array.from(multi.querySelectorAll(".tsingle"));
    const blocks: string[] = [];
    for (const part of parts) {
      const lines = Array.from(part.querySelectorAll("img"))
        .map(imageMarkdown)
        .filter((line): line is string => Boolean(line));
      const caption = captionMarkdown(part.querySelector(".thumbcaption"));
      if (lines.length > 0) blocks.push([...lines, caption].filter(Boolean).join("\n\n"));
    }
    const wholeCaption = captionMarkdown(
      Array.from(multi.querySelectorAll(".thumbcaption")).find((c) => !c.closest(".tsingle")) ??
        null,
    );
    if (blocks.length === 0) {
      multi.remove();
    } else {
      if (wholeCaption) blocks.push(wholeCaption);
      multi.replaceWith(makeParagraph(ctx.doc, token(ctx, blocks.join("\n\n"))));
    }
  }

  // Thumbnails and framed pictures.
  for (const figure of Array.from(root.querySelectorAll("figure"))) {
    if (!root.contains(figure)) continue;
    swapForImages(
      ctx,
      figure,
      Array.from(figure.querySelectorAll("img")),
      captionMarkdown(figure.querySelector("figcaption")),
    );
  }

  // Pictures inside the text.
  for (const img of Array.from(root.querySelectorAll("img"))) {
    if (!root.contains(img)) continue;
    const target =
      img.closest('span[typeof^="mw:File"]') ?? img.closest("a.mw-file-description") ?? img;
    const markdown = imageMarkdown(img);
    if (markdown) target.replaceWith(ctx.doc.createTextNode(token(ctx, markdown)));
    else target.remove();
  }
}

// --- Tables ----------------------------------------------------------------

function ownRows(table: Element): Element[] {
  return Array.from(table.querySelectorAll("tr")).filter((row) => row.closest("table") === table);
}

function ownCells(row: Element): Element[] {
  return Array.from(row.children).filter((child) => /^(td|th)$/i.test(child.tagName));
}

function flattenLists(el: Element, ctx: Context): void {
  for (const li of Array.from(el.querySelectorAll("li"))) {
    const span = ctx.doc.createElement("span");
    while (li.firstChild) span.appendChild(li.firstChild);
    if (li.nextElementSibling) span.appendChild(ctx.doc.createTextNode("; "));
    li.replaceWith(span);
  }
  for (const list of Array.from(el.querySelectorAll("ul, ol, dl"))) unwrap(list);
  for (const br of Array.from(el.querySelectorAll("br"))) {
    br.replaceWith(ctx.doc.createTextNode("; "));
  }
}

/** One table cell as a single line of Markdown. */
function cellMarkdown(cell: Element, ctx: Context): string {
  const clone = cell.cloneNode(true) as Element;
  removeAll(clone, "figure, style");
  // A flag or rating star is only worth its alt text in a cell.
  for (const img of Array.from(clone.querySelectorAll("img"))) {
    img.replaceWith(ctx.doc.createTextNode(collapse(img.getAttribute("alt") ?? "")));
  }
  for (const a of Array.from(clone.querySelectorAll("a"))) {
    if (/\/wiki\/(?:File|Image):/i.test(a.getAttribute("href") ?? "")) unwrap(a);
  }
  for (const nested of Array.from(clone.querySelectorAll("table"))) {
    nested.replaceWith(ctx.doc.createTextNode(collapse(nested.textContent ?? "")));
  }
  flattenLists(clone, ctx);
  const text = oneLine(htmlToMarkdown(clone.innerHTML))
    .replace(/\s+;/g, ";")
    .replace(/(?:;\s*){2,}/g, "; ")
    .replace(/^;\s*|\s*;$/g, "")
    .replace(/\|/g, "\\|");
  return text.trim();
}

function renderGfmTable(rows: string[][]): string {
  const [header, ...body] = rows;
  if (!header) return "";
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...body.map(line)].join("\n");
}

function isSimpleTable(rows: Element[]): boolean {
  if (rows.length === 0) return false;
  const widths = new Set<number>();
  for (const row of rows) {
    const cells = ownCells(row);
    if (cells.length === 0) return false;
    widths.add(cells.length);
    for (const cell of cells) {
      if (attrNumber(cell, "colspan") > 1 || attrNumber(cell, "rowspan") > 1) return false;
      if (cell.querySelector("table")) return false;
    }
  }
  return widths.size === 1;
}

function tableMarkdown(table: Element, ctx: Context): string {
  const rows = ownRows(table);
  const caption = captionMarkdown(
    Array.from(table.children).find((child) => child.tagName.toLowerCase() === "caption") ?? null,
  );
  let body: string;
  if (isSimpleTable(rows)) {
    // Spacer rows with nothing in them are dropped.
    body = renderGfmTable(
      rows
        .map((row) => ownCells(row).map((cell) => cellMarkdown(cell, ctx)))
        .filter((cells, index) => index === 0 || cells.some(Boolean)),
    );
  } else {
    body = rows
      .map((row) =>
        ownCells(row)
          .map((cell) => cellMarkdown(cell, ctx))
          .filter(Boolean),
      )
      .filter((cells) => cells.length > 0)
      .map((cells) => `- ${cells.join(" · ")}`)
      .join("\n");
  }
  return [caption, body].filter(Boolean).join("\n\n");
}

function isInfobox(table: Element): boolean {
  return (table.getAttribute("class") ?? "").split(/\s+/).some((c) => c === "infobox");
}

function infoboxMarkdown(table: Element, ctx: Context): string {
  const images: string[] = [];
  const rows: string[][] = [];
  for (const row of ownRows(table)) {
    const cells = ownCells(row);
    const img = row.querySelector("img");
    if (img && cells.length === 1) {
      const markdown = imageMarkdown(img);
      if (markdown) {
        const caption = captionMarkdown(row.querySelector(".infobox-caption"));
        images.push([markdown, caption].filter(Boolean).join("\n\n"));
      }
      continue;
    }
    const [label, value] = cells;
    if (cells.length !== 2 || !label || !value || label.tagName.toLowerCase() !== "th") continue;
    const field = cellMarkdown(label, ctx);
    const text = cellMarkdown(value, ctx);
    if (field && text) rows.push([field, text]);
  }
  const parts = [...images];
  if (rows.length > 0) parts.push(renderGfmTable([["Field", "Value"], ...rows]));
  return parts.join("\n\n");
}

/** Converts every table. Returns the infobox paragraph that belongs after the lead, if any. */
function replaceTables(root: Element, ctx: Context, order: Map<Element, number>): Element | null {
  let leadInfobox: Element | null = null;
  const firstHeading = root.querySelector("h1, h2, h3, h4, h5, h6");
  const headingIndex = firstHeading ? (order.get(firstHeading) ?? Infinity) : Infinity;

  for (const table of Array.from(root.querySelectorAll("table"))) {
    if (!root.contains(table)) continue;
    if (table.parentElement?.closest("table")) continue;

    // A table that only lays out other tables (side-by-side sales tables, say) is dissolved; the
    // tables inside are converted on their own turn.
    if (!isInfobox(table) && table.querySelector("table")) {
      const layout = ctx.doc.createElement("div");
      for (const row of ownRows(table)) {
        for (const cell of ownCells(row)) {
          const part = ctx.doc.createElement("div");
          while (cell.firstChild) part.appendChild(cell.firstChild);
          layout.appendChild(part);
        }
      }
      table.replaceWith(layout);
      continue;
    }

    if (isInfobox(table)) {
      const markdown = infoboxMarkdown(table, ctx);
      if (!markdown) {
        table.remove();
        continue;
      }
      const paragraph = makeParagraph(ctx.doc, token(ctx, markdown));
      const inLead = (order.get(table) ?? Infinity) < headingIndex;
      if (inLead && !leadInfobox) {
        leadInfobox = paragraph;
        table.remove();
      } else {
        table.replaceWith(paragraph);
      }
      continue;
    }

    const markdown = tableMarkdown(table, ctx);
    if (markdown) table.replaceWith(makeParagraph(ctx.doc, token(ctx, markdown)));
    else table.remove();
  }
  return leadInfobox;
}

function placeInfobox(root: Element, infobox: Element, order: Map<Element, number>): void {
  const firstHeading = root.querySelector("h1, h2, h3, h4, h5, h6");
  const headingIndex = firstHeading ? (order.get(firstHeading) ?? Infinity) : Infinity;
  // Paragraphs made from tables and pictures aren't in the map, so they never count as the lead.
  const lead = Array.from(root.querySelectorAll("p")).find(
    (p) =>
      collapse(p.textContent ?? "").length > 0 &&
      !p.closest("table, figure, li, dd, blockquote") &&
      (order.get(p) ?? Infinity) < headingIndex,
  );
  if (lead) lead.after(infobox);
  else root.insertBefore(infobox, root.firstChild);
}

// --- Headings and output ---------------------------------------------------

function demoteHeadings(root: Element, ctx: Context): void {
  const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  for (const heading of headings) {
    if (!collapse(heading.textContent ?? "")) heading.remove();
  }
  const remaining = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  if (!remaining.some((h) => h.tagName.toLowerCase() === "h1")) return;
  for (const heading of remaining) {
    const level = Math.min(Number(heading.tagName.slice(1)) + 1, 6);
    const next = ctx.doc.createElement(`h${level}`);
    while (heading.firstChild) next.appendChild(heading.firstChild);
    heading.replaceWith(next);
  }
}

function restoreTokens(markdown: string, ctx: Context): string {
  let out = markdown;
  // Tokens can hold other tokens (a caption with a footnote or a formula).
  for (let pass = 0; pass < 4 && TOKEN_PATTERN.test(out); pass++) {
    TOKEN_PATTERN.lastIndex = 0;
    out = out.replace(TOKEN_PATTERN, (_m, n: string) => ctx.tokens[Number(n)] ?? "");
  }
  TOKEN_PATTERN.lastIndex = 0;
  return out.replace(FOOTNOTE_PATTERN, (_m, n: string) => `[^${n}]`);
}

// `[^76][^77][^76]` becomes `[^76][^77]`, like Grokipedia.
function dedupeCitationRuns(markdown: string): string {
  return markdown.replace(/\[\^\d+\](?:[ \t]*\[\^\d+\])+/g, (run) => {
    const markers = run.match(/\[\^\d+\]/g) ?? [];
    return Array.from(new Set(markers)).join("");
  });
}

// A heading followed by a heading of the same or a higher level (or by nothing) has no content:
// typically the original "References" section once its list moved to the end.
function dropEmptySections(markdown: string): string {
  let lines = markdown.split("\n");
  let changed = true;
  while (changed) {
    changed = false;
    const next: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const heading = /^(#{2,6}) \S/.exec(line);
      if (heading?.[1]) {
        let j = i + 1;
        while (j < lines.length && (lines[j] ?? "").trim() === "") j++;
        const following = j < lines.length ? /^(#{2,6}) \S/.exec(lines[j] ?? "") : null;
        if (j >= lines.length || (following?.[1] && following[1].length <= heading[1].length)) {
          changed = true;
          continue;
        }
      }
      next.push(line);
    }
    lines = next;
  }
  return lines.join("\n");
}

function tidy(markdown: string): string {
  return (
    markdown
      .replace(/\r\n/g, "\n")
      .replace(/[^\S\n\t ]/g, " ")
      // Invisible: zero-width spaces and soft hyphens that templates and long words carry.
      .replace(INVISIBLE, "")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Converts the REST page HTML of a Wikipedia article to its Markdown body (no front matter and no
 * `# Title`). The document is changed in place.
 */
export function wikipediaToMarkdown(doc: Document, options: WikipediaConvertOptions): string {
  const root = doc.body ?? doc.documentElement;
  if (!root) return "";
  const ctx: Context = {
    doc,
    language: options.language,
    base: `https://${options.language}.wikipedia.org/wiki/`,
    tokens: [],
    definitions: [],
  };

  // Math first: its hidden MathML would otherwise be removed with the other hidden text.
  replaceMath(root, ctx);
  for (const selector of REMOVE_SELECTORS) removeAll(root, selector);
  normalizeLinks(root, ctx);
  replaceScripts(root, ctx);
  extractReferences(root, ctx);

  const order = new Map<Element, number>();
  Array.from(root.querySelectorAll("*")).forEach((el, index) => order.set(el, index));
  const infobox = replaceTables(root, ctx, order);
  if (infobox) placeInfobox(root, infobox, order);
  replaceImages(root, ctx);
  demoteHeadings(root, ctx);

  let body = tidy(htmlToMarkdown(root.innerHTML));
  body = tidy(dedupeCitationRuns(restoreTokens(body, ctx)));
  body = tidy(dropEmptySections(body));

  const parts: string[] = [];
  if (body) parts.push(body);
  if (ctx.definitions.length > 0) {
    const definitions = ctx.definitions.map((line) => restoreTokens(line, ctx));
    parts.push(`## References\n\n${definitions.join("\n")}`);
  }
  return parts.length > 0 ? `${parts.join("\n\n")}\n` : "";
}
