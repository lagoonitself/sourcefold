// Builds tiny, valid, single-font PDFs for the tests, so the fixtures stay readable in the repo
// instead of being checked-in binaries. Each page is a list of text lines, each drawn 14 pt below
// the one before it unless `gapBefore` says otherwise (use `PARAGRAPH_GAP` for a paragraph break).
// Only ASCII is supported. pdf.js reads these with its normal path (correct xref, no repair).

export interface PdfFixtureLine {
  text: string;
  /** Vertical space above this line, in points. Defaults to `LINE_GAP`. */
  gapBefore?: number;
}

export interface PdfFixturePage {
  lines: PdfFixtureLine[];
  /** Text size in points. Smaller sizes fit longer lines on the page. Defaults to 12. */
  fontSize?: number;
}

export interface PdfFixtureOptions {
  title?: string;
  author?: string;
  /** PDF date form, for example `D:20240103090000Z`. */
  creationDate?: string;
}

/** The usual distance between two lines at 12 pt. */
export const LINE_GAP = 14;
/** Twice the line gap, which the extractor reads as a paragraph break. */
export const PARAGRAPH_GAP = 28;

const FONT_SIZE = 12;
const LEFT_MARGIN = 72;
const TOP_MARGIN = 720;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

function pdfString(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/[\\()]/g, (character) => `\\${character}`);
}

function contentStream(page: PdfFixturePage): string {
  const parts = [
    "BT\n",
    `/F1 ${page.fontSize ?? FONT_SIZE} Tf\n`,
    `${LEFT_MARGIN} ${TOP_MARGIN} Td\n`,
  ];
  let first = true;
  for (const line of page.lines) {
    if (!first) parts.push(`0 ${-(line.gapBefore ?? LINE_GAP)} Td\n`);
    parts.push(`(${pdfString(line.text)}) Tj\n`);
    first = false;
  }
  parts.push("ET");
  return parts.join("");
}

/**
 * Builds the bytes of a PDF with one page per entry. Object numbers: 1 catalog, 2 page tree,
 * 3 font, then page/content pairs from 4, and an optional info dictionary last.
 */
export function buildPdf(pages: PdfFixturePage[], options: PdfFixtureOptions = {}): Uint8Array {
  const bodies = new Map<number, string>();
  const kids: number[] = [];

  for (let index = 0; index < pages.length; index += 1) {
    const pageNumber = 4 + index * 2;
    const contentNumber = pageNumber + 1;
    kids.push(pageNumber);
    const stream = contentStream(pages[index]!);
    bodies.set(
      pageNumber,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`,
    );
    bodies.set(contentNumber, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }

  bodies.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  bodies.set(
    2,
    `<< /Type /Pages /Kids [${kids.map((number) => `${number} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  bodies.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let infoRef = "";
  const info: string[] = [];
  if (options.title) info.push(`/Title (${pdfString(options.title)})`);
  if (options.author) info.push(`/Author (${pdfString(options.author)})`);
  if (options.creationDate) info.push(`/CreationDate (${pdfString(options.creationDate)})`);
  if (info.length > 0) {
    const infoNumber = 4 + pages.length * 2;
    bodies.set(infoNumber, `<< ${info.join(" ")} >>`);
    infoRef = ` /Info ${infoNumber} 0 R`;
  }

  const objectCount = 3 + pages.length * 2 + (infoRef ? 1 : 0);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let number = 1; number <= objectCount; number += 1) {
    offsets.push(out.length);
    out += `${number} 0 obj\n${bodies.get(number) ?? ""}\nendobj\n`;
  }

  const xrefOffset = out.length;
  out += `xref\n0 ${objectCount + 1}\n`;
  out += "0000000000 65535 f \n";
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R${infoRef} >>\n`;
  out += `startxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(out);
}
