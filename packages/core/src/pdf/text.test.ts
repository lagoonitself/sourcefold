import { describe, expect, it } from "vitest";
import {
  buildPdfMarkdown,
  isPageNumber,
  linesFromItems,
  meaningfulTitle,
  pdfCreationDate,
  repeatedLines,
  textItemsFromContent,
  titleFromFirstPage,
  titleFromPdfUrl,
  type PdfTextItem,
} from "./text";

function item(str: string, y: number, hasEOL = true): PdfTextItem {
  return { str, transform: [1, 0, 0, 1, 0, y], hasEOL };
}

describe("linesFromItems", () => {
  it("joins items on one baseline and starts a line on a new baseline", () => {
    const lines = linesFromItems(
      [item("Hello", 100, false), item(" world", 100, true), item("Next", 86, true)],
      0,
    );
    expect(lines).toEqual([
      { text: "Hello world", y: 100, page: 0 },
      { text: "Next", y: 86, page: 0 },
    ]);
  });

  it("also breaks on the end-of-line flag when the baseline does not move", () => {
    const lines = linesFromItems([item("one", 100, true), item("two", 100, true)], 0);
    expect(lines.map((line) => line.text)).toEqual(["one", "two"]);
  });

  it("keeps items whose position is unusable", () => {
    const lines = linesFromItems([{ str: "loose", transform: [] }], 0);
    expect(lines.map((line) => line.text)).toEqual(["loose"]);
  });
});

describe("textItemsFromContent", () => {
  it("keeps only entries with a string and normalizes the shape", () => {
    const items = textItemsFromContent([
      { str: "kept", transform: [1, 0, 0, 1, 0, 10], hasEOL: true },
      { transform: [1, 0, 0, 1, 0, 10] },
      { str: "no transform" },
    ]);
    expect(items).toEqual([
      { str: "kept", transform: [1, 0, 0, 1, 0, 10], hasEOL: true },
      { str: "no transform", transform: [], hasEOL: false },
    ]);
  });
});

describe("repeatedLines", () => {
  it("finds a header on most pages, with digits normalized", () => {
    const pages = [
      linesFromItems([item("Journal of Testing", 700), item("Page 1", 60)], 0),
      linesFromItems([item("Journal of Testing", 700), item("Page 2", 60)], 1),
      linesFromItems([item("Journal of Testing", 700), item("Page 3", 60)], 2),
    ];
    const repeated = repeatedLines(pages);
    expect(repeated.has("journal of testing")).toBe(true);
    expect(repeated.has("page #")).toBe(true);
  });

  it("ignores a line that appears on fewer than 60% of pages", () => {
    const pages = [
      linesFromItems([item("Sometimes", 700), item("body", 686)], 0),
      linesFromItems([item("Other", 700), item("body", 686)], 1),
      linesFromItems([item("Other", 700), item("body", 686)], 2),
    ];
    expect(repeatedLines(pages).has("sometimes")).toBe(false);
  });
});

describe("buildPdfMarkdown", () => {
  it("drops page numbers, running headers and footers, mends hyphens and splits paragraphs", () => {
    const pages = [
      [
        item("Running Head", 700),
        item("Alpha begins here and it", 670),
        item("con-", 656),
        item("tinues on the next line.", 642),
        item("1", 60),
      ],
      [item("Running Head", 700), item("Beta is a new paragraph.", 670), item("2", 60)],
      [item("Running Head", 700), item("Gamma closes it.", 670), item("3", 60)],
    ];
    const { markdown } = buildPdfMarkdown(pages);
    expect(markdown).toBe(
      "Alpha begins here and it continues on the next line.\n\n" +
        "Beta is a new paragraph.\n\n" +
        "Gamma closes it.",
    );
  });

  it("starts a paragraph when a sentence-ending line is followed by a much shorter one", () => {
    const pages = [[item("This sentence ends with a period.", 700), item("Short.", 686)]];
    expect(buildPdfMarkdown(pages).markdown).toBe("This sentence ends with a period.\n\nShort.");
  });

  it("returns nothing for a PDF with no text", () => {
    expect(buildPdfMarkdown([[]]).markdown).toBe("");
  });

  it("reports page 1's kept lines for the title fallback", () => {
    const pages = [
      [item("First Line", 700), item("Second line that is long enough to keep.", 686)],
    ];
    expect(buildPdfMarkdown(pages).firstPageLines).toEqual([
      "First Line",
      "Second line that is long enough to keep.",
    ]);
  });
});

describe("isPageNumber", () => {
  it("matches bare page numbers only", () => {
    expect(isPageNumber("12")).toBe(true);
    expect(isPageNumber("- 3 -")).toBe(true);
    expect(isPageNumber("(4)")).toBe(true);
    expect(isPageNumber("Page 3")).toBe(false);
    expect(isPageNumber("2024 results")).toBe(false);
  });
});

describe("meaningfulTitle", () => {
  it("rejects placeholders and file names", () => {
    expect(meaningfulTitle("")).toBeNull();
    expect(meaningfulTitle("   ")).toBeNull();
    expect(meaningfulTitle("untitled document")).toBeNull();
    expect(meaningfulTitle("Microsoft Word - thesis.docx")).toBeNull();
    expect(meaningfulTitle("chapter 3.pdf")).toBeNull();
    expect(meaningfulTitle(null)).toBeNull();
  });

  it("keeps a real title and collapses whitespace", () => {
    expect(meaningfulTitle("  A  Real   Title ")).toBe("A Real Title");
  });
});

describe("pdfCreationDate", () => {
  it("reads PDF's date form", () => {
    expect(pdfCreationDate("D:20240103090000Z")).toBe("2024-01-03");
    expect(pdfCreationDate("D:20240103")).toBe("2024-01-03");
  });

  it("returns null for anything else", () => {
    expect(pdfCreationDate("D:20241303")).toBeNull();
    expect(pdfCreationDate("garbage")).toBeNull();
    expect(pdfCreationDate(null)).toBeNull();
  });
});

describe("titleFromPdfUrl", () => {
  it("uses the file name without the extension", () => {
    expect(titleFromPdfUrl("https://example.com/papers/turbo_charging.pdf")).toBe("turbo charging");
    expect(titleFromPdfUrl("https://example.com/report.PDF")).toBe("report");
  });

  it("falls back to PDF when the address has no name", () => {
    expect(titleFromPdfUrl("https://example.com/")).toBe("PDF");
  });
});

describe("titleFromFirstPage", () => {
  it("takes the first short line", () => {
    expect(titleFromFirstPage(["", "  12 ", "The Actual Title", "A longer line"])).toBe(
      "The Actual Title",
    );
    expect(titleFromFirstPage(["x".repeat(200)])).toBeNull();
  });
});
