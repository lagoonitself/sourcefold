// Markdown to plain text for TL;DRs: what a person would read aloud, without link targets,
// images, footnote markers or emphasis marks. Not a full Markdown parser; good enough for the
// short passages TL;DRs are made of.

/** One block of a Markdown body: a heading, a paragraph or a list. */
export interface TextBlock {
  type: "heading" | "paragraph" | "list";
  /** Heading level (2 for `##`); 0 for other blocks. */
  level: number;
  /** Plain text; for a list, its items joined with newlines. */
  text: string;
  /** For a list, its items. */
  items: string[];
}

/** Inline Markdown to plain text. */
export function inlineToText(markdown: string): string {
  return (
    markdown
      // Images go first, so their alt text doesn't survive as a link.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      // Footnote markers [^1] (before links, so "[^1][12]" isn't read as a reference link).
      .replace(/\[\^[^\]]+\]/g, "")
      // [text](url) and [text][ref] keep the text; a bare [12:30](url) timestamp keeps "12:30".
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      // Wikipedia-style [12] citations.
      .replace(/\[(?:\d+|[a-z]|citation needed|note \d+)\]/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])[*_](?!\s)([^*_\n]+?)[*_](?=[^\w*]|$)/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ")
      .trim()
  );
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const FENCE = /^\s*(```|~~~)/;
const FOOTNOTE_DEF = /^\[\^[^\]]+\]:/;

/**
 * Splits a Markdown body into headings, paragraphs and lists, as plain text. Tables, code,
 * images, captions (a paragraph that is only italics right after an image), quotes' markers and
 * footnote definitions are left out.
 */
export function markdownBlocks(markdown: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: string[] = [];
  let inFence = false;
  let lastWasImage = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const raw = paragraph.join(" ");
    paragraph = [];
    const onlyImage = /^\s*(?:!\[[^\]]*\]\([^)]*\)\s*)+$/.test(raw);
    if (onlyImage) {
      lastWasImage = true;
      return;
    }
    const isCaption = lastWasImage && /^\s*[*_][^*_].*[*_]\s*$/.test(raw);
    lastWasImage = false;
    if (isCaption) return;
    const text = inlineToText(raw);
    if (text) blocks.push({ type: "paragraph", level: 0, text, items: [] });
  };
  const flushList = () => {
    if (list.length === 0) return;
    const items = list.map(inlineToText).filter(Boolean);
    list = [];
    lastWasImage = false;
    if (items.length > 0) blocks.push({ type: "list", level: 0, text: items.join("\n"), items });
  };

  for (const line of lines) {
    if (FENCE.test(line)) {
      flushParagraph();
      flushList();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = HEADING.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      lastWasImage = false;
      const text = inlineToText(heading[2] ?? "");
      if (text) blocks.push({ type: "heading", level: heading[1]!.length, text, items: [] });
      continue;
    }
    if (
      TABLE_ROW.test(line) ||
      FOOTNOTE_DEF.test(trimmed) ||
      /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)
    ) {
      flushParagraph();
      flushList();
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flushParagraph();
      list.push(item[1] ?? "");
      continue;
    }
    if (list.length > 0 && /^\s{2,}\S/.test(line)) {
      list[list.length - 1] += ` ${trimmed}`;
      continue;
    }
    flushList();
    paragraph.push(trimmed.replace(/^>\s?/, ""));
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Splits text into sentences (on . ! ? followed by a space and a capital, digit or quote). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?]["”')\]]?)\s+(?=["“(\[]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Roughly how many minutes a text takes to read, at 230 words a minute; at least 1. */
export function readingMinutes(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}
