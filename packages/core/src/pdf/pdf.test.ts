import { describe, expect, it } from "vitest";
import { pdfToCapture, loadPdfJsLegacy, type PdfToCaptureOptions, type LoadPdfJs } from "./pdf";
import { buildPdf } from "./fixtures/make-pdf";
import { measurementsPdf, scannedPdf, turbochargerPdf, wordTitlePdf } from "./fixtures/documents";

// pdf.js runs for real here (its legacy build, no worker), against the tiny PDFs built by
// `fixtures/make-pdf`. The body style is the one `test/golden/pdf-arxiv.md` shows.

function capture(pdf: Uint8Array, url: string, options: PdfToCaptureOptions = {}) {
  return pdfToCapture(pdf, url, options);
}

describe("pdfToCapture", () => {
  it("reads a PDF's metadata into the title and meta fields", async () => {
    const result = await capture(turbochargerPdf(), "https://example.com/turbocharging-basics.pdf");

    expect(result.title).toBe("Turbocharging Basics");
    expect(result.url).toBe("https://example.com/turbocharging-basics.pdf");
    expect(result.meta).toEqual({
      author: "Ada Lovelace",
      published: "2024-01-03",
      pages: 2,
      arxiv: null,
    });
  });

  it("rebuilds paragraphs, mends hyphenated breaks and drops headers, footers and page numbers", async () => {
    const result = await capture(turbochargerPdf(), "https://example.com/turbocharging-basics.pdf");

    expect(result.markdown).toBe(
      "This report explains how turbochargers work in engines. They compress the incoming air, " +
        "which raises its example density and the power the engine makes.\n\n" +
        "Efficiency is the main concern of this report.\n\n" +
        "The compressor and the turbine share a shaft. When exhaust gas spins the turbine, the " +
        "compressor turns too.",
    );
    expect(result.markdown).not.toContain("Turbochargers\n");
    expect(result.markdown).not.toContain("Sourcefold Press");
  });

  it("uses the first short line of page 1 when there is no metadata title", async () => {
    const result = await capture(measurementsPdf(), "https://example.com/download?id=42");

    expect(result.title).toBe("Notes on Measurements");
    expect(result.markdown).toBe(
      "Notes on Measurements\n\n" +
        "The instrument recorded every sample during the run.\n\n" +
        "Results vary. Every sample is kept, even the outliers.\n\n" +
        "Appendix: extra tables live in the archive.",
    );
    expect(result.meta.author).toBeNull();
    expect(result.meta.published).toBeNull();
  });

  it("refuses a metadata title that is really a file name", async () => {
    const result = await capture(wordTitlePdf(), "https://example.com/chapter-3.pdf");
    expect(result.title).toBe("A Real Chapter Title");
  });

  it("falls back to the file name when page 1 has no short line", async () => {
    // A small font keeps a 140-character line inside the page, past the 120-character limit.
    const pdf = buildPdf([{ lines: [{ text: "y".repeat(140) }], fontSize: 5 }]);
    const result = await capture(pdf, "https://example.com/papers/quarterly-report.pdf");
    expect(result.title).toBe("quarterly report");
  });

  it("loads pdf.js through the caller's loader", async () => {
    let calls = 0;
    const load: LoadPdfJs = () => {
      calls += 1;
      return loadPdfJsLegacy();
    };
    const result = await capture(turbochargerPdf(), "https://example.com/paper.pdf", {
      loadPdfJs: load,
    });
    expect(calls).toBe(1);
    expect(result.markdown.length).toBeGreaterThan(0);
  });

  it("explains a PDF with no text layer", async () => {
    await expect(capture(scannedPdf(), "https://example.com/scan.pdf")).rejects.toMatchObject({
      code: "parse_failed",
      message: "This PDF has no text to save. It's probably a scan.",
    });
  });

  it("explains a file that is not a readable PDF", async () => {
    const broken = new TextEncoder().encode("this is not a PDF at all, it is a text file");
    await expect(capture(broken, "https://example.com/broken.pdf")).rejects.toMatchObject({
      code: "parse_failed",
      message: "Couldn't read this PDF.",
    });
  });
});
