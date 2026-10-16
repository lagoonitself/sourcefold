// Turns the text items pdf.js reports for each page back into readable Markdown paragraphs.
// Kept free of pdf.js so it can be tested on plain objects: the shape below is the subset of
// pdf.js' `TextItem` this module reads.

/** The subset of pdf.js' `TextItem` used here. */
export interface PdfTextItem {
  str: string;
  /** PDF text matrix; index 5 is the baseline's y position. */
  transform: number[];
  /** pdf.js sets this on the last item of a line. */
  hasEOL?: boolean;
}

/** A line of text with its page and baseline position. */
export interface PdfLine {
  text: string;
  y: number;
  page: number;
}

export interface PdfTextResult {
  /** Body only: paragraphs joined by one blank line. Empty when the PDF has no text layer. */
  markdown: string;
  /** The kept lines of page 1, used to guess a title when the metadata has none. */
  firstPageLines: string[];
}

/** A page is dropped from the text entirely once this many pages are collected. */
export const MAX_PDF_PAGES = 2000;
/** Extraction stops once this much text has been collected. */
export const MAX_PDF_TEXT_LENGTH = 5 * 1024 * 1024;

const PAGE_NUMBER = /^[-–—(\[]?\s*\d{1,4}\s*[-–—)\]]?$/;
const SENTENCE_END = /[:.]$/;
/** Repeated headers or footers must show up on at least this share of pages to be dropped. */
const REPEAT_SHARE = 0.6;
/** A line this short after a line that ends a sentence starts a new paragraph. */
const SHORT_LINE_RATIO = 0.6;
const SHORT_LINE_MIN_PREVIOUS = 20;

function isTextItem(value: unknown): value is PdfTextItem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { str?: unknown }).str === "string"
  );
}

/** Reads the text items pdf.js returned, keeping only the ones that carry a string. */
export function textItemsFromContent(items: readonly unknown[]): PdfTextItem[] {
  return items.filter(isTextItem).map((item) => ({
    str: item.str,
    transform: Array.isArray(item.transform) ? item.transform : [],
    hasEOL: item.hasEOL === true,
  }));
}

/** Groups one page's items into lines using their y position and the end-of-line flags. */
export function linesFromItems(items: readonly PdfTextItem[], page: number): PdfLine[] {
  const lines: PdfLine[] = [];
  let current: { parts: string[]; y: number } | null = null;

  const flush = (): void => {
    if (current === null) return;
    const text = current.parts.join("").replace(/\s+/g, " ").trim();
    if (text) lines.push({ text, y: current.y, page });
    current = null;
  };

  for (const item of items) {
    const y = item.transform[5];
    if (typeof y !== "number" || !Number.isFinite(y)) {
      // Items without a usable position still carry text; keep them on the current line.
      if (current) current.parts.push(item.str);
      else current = { parts: [item.str], y: 0 };
    } else {
      if (current && Math.abs(y - current.y) > 1) flush();
      if (!current) current = { parts: [], y };
      current.parts.push(item.str);
    }
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

/** Digits become `#` so "Page 3" and "Page 4" compare equal. */
function normalizeRepeat(text: string): string {
  return text.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Finds header and footer texts that repeat on most pages: a normalized line that shows up as
 * the first or last line of at least 60% of the pages.
 */
export function repeatedLines(pages: readonly (readonly PdfLine[])[]): Set<string> {
  const repeated = new Set<string>();
  if (pages.length < 2) return repeated;
  const needed = Math.ceil(pages.length * REPEAT_SHARE);

  for (const edge of ["first", "last"] as const) {
    const counts = new Map<string, number>();
    for (const lines of pages) {
      if (lines.length === 0) continue;
      const line = edge === "first" ? lines[0]! : lines[lines.length - 1]!;
      const key = normalizeRepeat(line.text);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      if (count >= needed) repeated.add(key);
    }
  }
  return repeated;
}

/** True for a bare page number, which is never part of the text. */
export function isPageNumber(text: string): boolean {
  return PAGE_NUMBER.test(text.trim());
}

/**
 * Drops page numbers and lines that repeat as a header or footer on most pages, then joins the
 * rest into paragraphs. A gap larger than 1.5x the usual line gap, a page break, or a much
 * shorter line after a line that ends a sentence starts a new paragraph. Hyphenated line breaks
 * between lowercase letters are mended.
 */
export function buildPdfMarkdown(pages: readonly (readonly PdfTextItem[])[]): PdfTextResult {
  const perPage: PdfLine[][] = [];
  const repeated: Set<string> = new Set();

  let collected = 0;
  for (let index = 0; index < pages.length && index < MAX_PDF_PAGES; index += 1) {
    const lines = linesFromItems(pages[index]!, index);
    collected += lines.reduce((sum, line) => sum + line.text.length, 0);
    perPage.push(lines);
    if (collected > MAX_PDF_TEXT_LENGTH) break;
  }

  const forRepeats = perPage.map((lines) => lines.filter((line) => !isPageNumber(line.text)));
  for (const key of repeatedLines(forRepeats)) repeated.add(key);

  const kept: PdfLine[] = [];
  for (const lines of perPage) {
    const usable = lines.filter((line) => !isPageNumber(line.text));
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (isPageNumber(line.text)) continue;
      const atEdge = line === usable[0] || line === usable[usable.length - 1];
      if (atEdge && repeated.has(normalizeRepeat(line.text))) continue;
      kept.push(line);
    }
  }

  if (kept.length === 0) return { markdown: "", firstPageLines: [] };

  const typicalGap = medianGap(kept);
  const paragraphs: string[] = [];
  let paragraph = "";
  let previous: PdfLine | null = null;

  for (const line of kept) {
    if (previous !== null) {
      const newPage = line.page !== previous.page;
      const gap = previous.y - line.y;
      const piece = joinLines(paragraph, line.text);
      if (newPage || startsNewParagraph(line, previous, gap, typicalGap)) {
        if (paragraph) paragraphs.push(paragraph);
        paragraph = line.text;
      } else {
        paragraph = piece;
      }
    } else {
      paragraph = line.text;
    }
    previous = line;
  }
  if (paragraph) paragraphs.push(paragraph);

  const markdown = paragraphs.join("\n\n").trim();
  const firstPageLines = kept.filter((line) => line.page === 0).map((line) => line.text);
  return { markdown, firstPageLines };
}

/** The middle positive line gap across the text, used as the baseline for the 1.5x rule. */
function medianGap(lines: readonly PdfLine[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const previous = lines[i - 1]!;
    const current = lines[i]!;
    if (current.page !== previous.page) continue;
    const gap = previous.y - current.y;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? 0;
}

function startsNewParagraph(
  next: PdfLine,
  previous: PdfLine,
  gap: number,
  typicalGap: number,
): boolean {
  if (typicalGap > 0 && gap > typicalGap * 1.5) return true;
  return (
    SENTENCE_END.test(previous.text) &&
    previous.text.length >= SHORT_LINE_MIN_PREVIOUS &&
    next.text.length < previous.text.length * SHORT_LINE_RATIO
  );
}

/** Joins a line onto the paragraph, mending a hyphen between two lowercase letters. */
function joinLines(paragraph: string, next: string): string {
  const trimmed = paragraph.replace(/\s+$/, "");
  if (/[a-z]-$/.test(trimmed) && /^[a-z]/.test(next)) {
    return `${trimmed.slice(0, -1)}${next}`;
  }
  return `${trimmed} ${next}`.trim();
}

// ---------------------------------------------------------------------------------------------
// Title, author and date

const FILE_NAME_TITLE = /\.(docx?|pdf|tex|indd|rtf|pptx?|xlsx?|odt|pages)$/i;
const WORD_TITLE = /^(microsoft word|microsoft powerpoint|microsoft excel)\b/i;

/** A PDF metadata title is only used when it is a real title, not a placeholder or a file name. */
export function meaningfulTitle(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const title = raw.replace(/\s+/g, " ").trim();
  if (!title) return null;
  if (/^untitled/i.test(title)) return null;
  if (WORD_TITLE.test(title)) return null;
  if (FILE_NAME_TITLE.test(title)) return null;
  return title.length > 500 ? title.slice(0, 500).trim() : title;
}

/** `D:YYYYMMDD…` (PDF's date form) as `YYYY-MM-DD`, or null when it isn't a usable date. */
export function pdfCreationDate(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const match = /^D:(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return null;
  return `${year}-${month}-${day}`;
}

/** The file name from the PDF's address, without `.pdf`, as a last-resort title. */
export function titleFromPdfUrl(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not a URL; use the string as it is.
  }
  const segment = path.split("/").filter(Boolean).pop() ?? "";
  let name = segment;
  try {
    name = decodeURIComponent(segment);
  } catch {
    // Keep the raw segment.
  }
  const withoutExtension = name
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return withoutExtension || "PDF";
}

/** The first line of page 1 short enough to be a title. */
export function titleFromFirstPage(lines: readonly string[]): string | null {
  for (const line of lines) {
    const text = line.trim();
    if (!text || isPageNumber(text)) continue;
    if (text.length <= 120) return text;
  }
  return null;
}
