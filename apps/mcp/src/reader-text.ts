import {
  isTimestampLabel,
  parseFootnoteDefinition,
  parseReaderFile,
  parseTimestampHref,
  renderMarkdown,
  SOURCE_SPAN_ATTR,
  type FootnoteDef,
  type FootnoteRef,
  type RenderedBlock,
  type TimestampMark,
} from "@sourcefold/core/reader";
import { parseHtmlOnServer } from "@sourcefold/core/server";

// The text the desktop reader shows for a source, rebuilt here so highlights and removals Claude
// makes have the same offsets as the reader's own. The reader renders the file's body with
// `renderMarkdown` into one element and counts characters of its `textContent`; its timestamp and
// footnote lookups (apps/desktop/src/features/reader/dom-anchoring.ts) are mirrored below.

export interface ReaderText {
  /** The body as saved: the file without front matter, title, source line, highlights and note. */
  body: string;
  text: string;
  /** Each removable block (`data-sf-src`) and where its text starts in `text`. */
  blocks: RenderedBlock[];
  /** [start, end) of each footnote marker (`[15]`) in `text`; quotes may leave them out. */
  footnoteMarkers: Array<[number, number]>;
  timestamps: { marks: TimestampMark[]; end: number };
  footnotes: { refs: FootnoteRef[]; defs: Map<string, FootnoteDef> };
}

export function readerTextOf(file: string): ReaderText {
  const { body } = parseReaderFile(file);
  // The source map only adds attributes, so the text is the same as the reader's.
  const html = body.trim() ? renderMarkdown(body, { sourceMap: true }) : "";
  const doc = parseHtmlOnServer(
    `<!doctype html><html><body><div id="sf-root">${html}</div></body></html>`,
  );
  const root = doc.getElementById("sf-root") as Element;

  // Characters of text before each element, in document order (what a DOM Range would count).
  const startOf = new Map<Node, number>();
  let text = "";
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) text += (child as Text).data;
      else if (child.nodeType === 1) {
        startOf.set(child, text.length);
        walk(child);
      }
    }
  };
  walk(root);
  const offsetOf = (el: Element) => startOf.get(el) ?? 0;

  const marks: TimestampMark[] = [];
  for (const a of Array.from(root.querySelectorAll("a[href]"))) {
    if (!isTimestampLabel(a.textContent ?? "") || !a.firstChild) continue;
    const seconds = parseTimestampHref(a.getAttribute("href") ?? "");
    if (seconds !== null) marks.push({ offset: offsetOf(a), seconds });
  }
  let end = Infinity;
  const last = marks[marks.length - 1];
  if (last) {
    for (const heading of Array.from(root.querySelectorAll("h1, h2, h3"))) {
      const at = offsetOf(heading);
      if (at > last.offset) {
        end = at;
        break;
      }
    }
  }

  const defs = new Map<string, FootnoteDef>();
  for (const li of Array.from(root.querySelectorAll("ul.footnotes > li"))) {
    const label = (li.querySelector(".fn-label")?.textContent ?? "").replace(/^\[|\]$/g, "").trim();
    const fnBody = li.querySelector(".fn-text");
    if (!label || !fnBody || defs.has(label)) continue;
    const def = parseFootnoteDefinition(label, {
      text: fnBody.textContent ?? "",
      links: Array.from(fnBody.querySelectorAll("a")).map((a) => ({
        href: a.getAttribute("href") ?? "",
        text: a.textContent ?? "",
      })),
    });
    if (def) defs.set(label, def);
  }
  const refs: FootnoteRef[] = [];
  for (const a of Array.from(root.querySelectorAll("sup.fn-ref > a"))) {
    const label = (a.textContent ?? "").replace(/^\[|\]$/g, "").trim();
    if (a.firstChild && label) refs.push({ offset: offsetOf(a), label });
  }
  const footnoteMarkers: Array<[number, number]> = Array.from(
    root.querySelectorAll("sup.fn-ref"),
  ).map((sup) => {
    const start = offsetOf(sup);
    return [start, start + (sup.textContent ?? "").length];
  });

  // The removable blocks, as the reader's `renderedBlocks` finds them (features/reader/removal.ts).
  const blocks: RenderedBlock[] = [];
  for (const el of Array.from(root.querySelectorAll(`[${SOURCE_SPAN_ATTR}]`))) {
    const [start, end] = (el.getAttribute(SOURCE_SPAN_ATTR) ?? "").split("-").map(Number);
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    blocks.push({ start: start!, end: end!, textStart: offsetOf(el), text: el.textContent ?? "" });
  }

  return {
    body,
    text,
    blocks,
    footnoteMarkers,
    timestamps: { marks, end },
    footnotes: { refs, defs },
  };
}

/** The text the reader shows for a body, and the images in it. */
export function renderedViewOf(body: string): { text: string; images: Set<string> } {
  const html = body.trim() ? renderMarkdown(body) : "";
  const doc = parseHtmlOnServer(
    `<!doctype html><html><body><div id="sf-root">${html}</div></body></html>`,
  );
  const root = doc.getElementById("sf-root") as Element;
  const images = new Set(
    Array.from(root.querySelectorAll("img"))
      .map((img) => img.getAttribute("src"))
      .filter((src): src is string => Boolean(src)),
  );
  return { text: root.textContent ?? "", images };
}

// ----------------------------------------------------------------------------------------------
// Finding a quote. Claude quotes what read_source showed it, which is Markdown; the reader's text
// has no `**`, link targets or extra spaces. Both sides are normalized (whitespace runs, curly
// quotes, dashes) with a map back to the real offsets.
// ----------------------------------------------------------------------------------------------

/** Markdown syntax a quote may carry that the rendered text doesn't have. */
export function stripMarkdown(quote: string): string {
  return quote
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
    .replace(/\[\^([^\]\s]+)\]/g, "[$1]")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/(^|[\s(])\*(?=\S)|(?<=\S)\*(?=[\s).,;:!?]|$)/g, "$1");
}

function foldChar(ch: string): string {
  switch (ch) {
    case "‘":
    case "’":
    case "‛":
    case "′":
      return "'";
    case "“":
    case "”":
    case "‟":
    case "″":
      return '"';
    case "–":
    case "—":
    case "−":
      return "-";
    case "…":
      return "...";
    default:
      return ch;
  }
}

interface Folded {
  text: string;
  /** For each folded character, the index of the original character it came from. */
  map: number[];
}

/** Characters inside `skip` ranges ([start, end), sorted) are left out as if they weren't there. */
function fold(input: string, lower: boolean, skip: ReadonlyArray<[number, number]> = []): Folded {
  let text = "";
  const map: number[] = [];
  let pendingSpace = -1;
  let range = 0;
  for (let i = 0; i < input.length; i++) {
    while (range < skip.length && skip[range]![1] <= i) range++;
    const skipped = skip[range];
    if (skipped && i >= skipped[0]) {
      i = skipped[1] - 1;
      continue;
    }
    const ch = input.charAt(i);
    if (/\s/.test(ch)) {
      if (pendingSpace === -1) pendingSpace = i;
      continue;
    }
    if (pendingSpace !== -1) {
      if (text) {
        text += " ";
        map.push(pendingSpace);
      }
      pendingSpace = -1;
    }
    const folded = foldChar(lower ? ch.toLowerCase() : ch);
    for (const piece of folded) {
      text += piece;
      map.push(i);
    }
  }
  return { text, map };
}

export interface QuoteMatch {
  start: number;
  end: number;
  /** How many places the quote appears; the first is used. */
  occurrences: number;
}

/** The quote in the folded text, searching from the original offset `from`. */
function findFolded(hay: Folded, quote: string, lower: boolean, from = 0): QuoteMatch | null {
  const needle = fold(quote, lower).text;
  if (!needle) return null;
  let fromFolded = 0;
  while (fromFolded < hay.map.length && hay.map[fromFolded]! < from) fromFolded++;
  const at = hay.text.indexOf(needle, fromFolded);
  if (at === -1) return null;
  let occurrences = 0;
  for (let next = at; next !== -1; next = hay.text.indexOf(needle, next + 1)) occurrences++;
  const start = hay.map[at] ?? 0;
  const end = (hay.map[at + needle.length - 1] ?? start) + 1;
  return { start, end, occurrences };
}

function findIn(
  text: string,
  quote: string,
  skip: ReadonlyArray<[number, number]>,
): QuoteMatch | null {
  const folded = [false, true].map((lower) => ({ lower, hay: fold(text, lower, skip) }));
  for (const { lower, hay } of folded) {
    const whole = findFolded(hay, quote, lower);
    if (whole) return whole;
  }

  const parts = quote
    .split(/\s*(?:\.\.\.|…|\[…\]|\[\.\.\.\])\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0]!;
  const lastPart = parts[parts.length - 1]!;
  for (const { lower, hay } of folded) {
    const head = findFolded(hay, first, lower);
    if (!head) continue;
    const tail = findFolded(hay, lastPart, lower, head.end);
    if (!tail) continue;
    return { start: head.start, end: tail.end, occurrences: head.occurrences };
  }
  return null;
}

/** Footnote markers as a quote may carry them: `[^15]`, or `[15]` as the reader shows them. */
const FOOTNOTE_MARKER = /\[\^?[\w-]{1,20}\]/g;

/**
 * Finds the passage; "first words … last words" spans from the first part to the last. Footnote
 * markers (`[15]`, `[^15]`) may be left out of the quote, or kept.
 */
export function findQuote(
  text: string,
  rawQuote: string,
  footnoteMarkers: ReadonlyArray<[number, number]> = [],
): QuoteMatch | null {
  const quote = stripMarkdown(rawQuote).trim();
  if (!quote) return null;
  const asQuoted = findIn(text, quote, []);
  if (asQuoted || footnoteMarkers.length === 0) return asQuoted;
  const withoutMarkers = quote.replace(FOOTNOTE_MARKER, "").trim();
  return withoutMarkers ? findIn(text, withoutMarkers, footnoteMarkers) : null;
}
