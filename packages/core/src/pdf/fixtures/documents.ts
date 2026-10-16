// The PDF fixtures the tests read, built from `make-pdf` so they stay reviewable in git.

import { buildPdf, LINE_GAP, PARAGRAPH_GAP, type PdfFixturePage } from "./make-pdf";

/**
 * Two pages with a running header, a running footer and page numbers, a hyphenated line break
 * and a paragraph break wider than the line gap. Metadata has a title, an author and a date.
 */
export function turbochargerPdf(): Uint8Array {
  const pages: PdfFixturePage[] = [
    {
      lines: [
        { text: "Turbochargers" },
        {
          text: "This report explains how turbochargers work in engines.",
          gapBefore: PARAGRAPH_GAP,
        },
        { text: "They compress the incoming air, which raises its", gapBefore: LINE_GAP },
        { text: "exam-", gapBefore: LINE_GAP },
        { text: "ple density and the power the engine makes.", gapBefore: LINE_GAP },
        { text: "Efficiency is the main concern of this report.", gapBefore: PARAGRAPH_GAP },
        { text: "Sourcefold Press", gapBefore: LINE_GAP },
        { text: "1", gapBefore: LINE_GAP },
      ],
    },
    {
      lines: [
        { text: "Turbochargers" },
        { text: "The compressor and the turbine share a shaft.", gapBefore: PARAGRAPH_GAP },
        {
          text: "When exhaust gas spins the turbine, the compressor turns too.",
          gapBefore: LINE_GAP,
        },
        { text: "Sourcefold Press", gapBefore: LINE_GAP },
        { text: "2", gapBefore: LINE_GAP },
      ],
    },
  ];

  return buildPdf(pages, {
    title: "Turbocharging Basics",
    author: "Ada Lovelace",
    creationDate: "D:20240103090000Z",
  });
}

/** No metadata title: the title falls back to the first short line of page 1. */
export function measurementsPdf(): Uint8Array {
  const pages: PdfFixturePage[] = [
    {
      lines: [
        { text: "Notes on Measurements" },
        { text: "The instrument recorded every sample during the run.", gapBefore: PARAGRAPH_GAP },
        // A line that ends a sentence, followed by a much shorter line: a new paragraph.
        { text: "Results vary.", gapBefore: LINE_GAP },
        { text: "Every sample is kept, even the outliers.", gapBefore: LINE_GAP },
      ],
    },
    { lines: [{ text: "Appendix: extra tables live in the archive." }] },
  ];

  return buildPdf(pages);
}

/** A PDF whose metadata title is a Word file name, which must not be used. */
export function wordTitlePdf(): Uint8Array {
  return buildPdf([{ lines: [{ text: "A Real Chapter Title" }, { text: "Body text." }] }], {
    title: "Microsoft Word - thesis final.docx",
  });
}

/** A PDF with no text layer at all, like a scanned page. */
export function scannedPdf(): Uint8Array {
  return buildPdf([{ lines: [] }]);
}
