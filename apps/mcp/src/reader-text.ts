import {
  isTimestampLabel,
  parseFootnoteDefinition,
  parseReaderFile,
  parseTimestampHref,
  renderMarkdown,
  type FootnoteDef,
  type FootnoteRef,
  type TimestampMark,
} from "@sourcefold/core/reader";
import { parseHtmlOnServer } from "@sourcefold/core/server";

// The text the desktop reader shows for a source, rebuilt here so highlights Claude makes have the
// same offsets as highlights made in the reader. The reader renders the file's body with
// `renderMarkdown` into one element and counts characters of its `textContent`; its timestamp and
// footnote lookups (apps/desktop/src/features/reader/dom-anchoring.ts) are mirrored below.

export interface ReaderText {
  text: string;
  timestamps: { marks: TimestampMark[]; end: number };
  footnotes: { refs: FootnoteRef[]; defs: Map<string, FootnoteDef> };
}

export function readerTextOf(file: string): ReaderText {
  const { body } = parseReaderFile(file);
  const html = body.trim() ? renderMarkdown(body) : "";
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

  return { text, timestamps: { marks, end }, footnotes: { refs, defs } };
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

function fold(input: string, lower: boolean): Folded {
  let text = "";
  const map: number[] = [];
  let pendingSpace = -1;
  for (let i = 0; i < input.length; i++) {
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

function findFolded(text: string, quote: string, lower: boolean): QuoteMatch | null {
  const hay = fold(text, lower);
  const needle = fold(quote, lower).text;
  if (!needle) return null;
  const at = hay.text.indexOf(needle);
  if (at === -1) return null;
  let occurrences = 0;
  for (let from = at; from !== -1; from = hay.text.indexOf(needle, from + 1)) occurrences++;
  const start = hay.map[at] ?? 0;
  const end = (hay.map[at + needle.length - 1] ?? start) + 1;
  return { start, end, occurrences };
}

/** Finds the passage; "first words … last words" spans from the first part to the last. */
export function findQuote(text: string, rawQuote: string): QuoteMatch | null {
  const quote = stripMarkdown(rawQuote).trim();
  if (!quote) return null;
  for (const lower of [false, true]) {
    const whole = findFolded(text, quote, lower);
    if (whole) return whole;
  }

  const parts = quote
    .split(/\s*(?:\.\.\.|…|\[…\]|\[\.\.\.\])\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0]!;
  const lastPart = parts[parts.length - 1]!;
  for (const lower of [false, true]) {
    const head = findFolded(text, first, lower);
    if (!head) continue;
    const tail = findFolded(text.slice(head.end), lastPart, lower);
    if (!tail) continue;
    return { start: head.start, end: head.end + tail.end, occurrences: head.occurrences };
  }
  return null;
}
