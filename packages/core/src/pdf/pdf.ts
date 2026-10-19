import type { SourceCapture } from "../capture-types";
import { SourceError } from "../source-fetch";
import {
  buildPdfMarkdown,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_LENGTH,
  meaningfulTitle,
  pdfCreationDate,
  textItemsFromContent,
  titleFromFirstPage,
  titleFromPdfUrl,
  type PdfTextItem,
} from "./text";

// Reads a PDF with Mozilla's pdf.js (Apache-2.0). The legacy build runs in Node without a
// worker; the caller can pass its own loader so a browser bundle only pulls pdf.js in when a
// PDF is actually saved. Nothing here lets pdf.js fetch anything itself.

export type PdfJsModule = typeof import("pdfjs-dist");
export type LoadPdfJs = () => Promise<PdfJsModule>;

/** Loads pdf.js' legacy build: works in Node and in workers without a separate worker file. */
export const loadPdfJsLegacy: LoadPdfJs = () =>
  import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<PdfJsModule>;

export interface PdfToCaptureOptions {
  /** Defaults to pdf.js' legacy build (`loadPdfJsLegacy`). */
  loadPdfJs?: LoadPdfJs;
}

/** Below this much text a PDF is treated as a scan rather than a document. */
const MIN_TEXT_LENGTH = 16;

const READ_FAILED = "Couldn't read this PDF.";
const NO_TEXT = "This PDF has no text to save. It's probably a scan.";

/**
 * Extracts the text of every page, rebuilds paragraphs, and returns a `SourceCapture` with the
 * PDF's `author`, `published` and `pages` fields (`arxiv` is null; the arXiv caller fills it).
 */
export async function pdfToCapture(
  bytes: Uint8Array,
  url: string,
  options: PdfToCaptureOptions = {},
): Promise<SourceCapture> {
  const load = options.loadPdfJs ?? loadPdfJsLegacy;
  let pdfjs: PdfJsModule;
  try {
    pdfjs = await load();
  } catch {
    throw new SourceError("parse_failed", READ_FAILED);
  }

  let task: ReturnType<PdfJsModule["getDocument"]>;
  let document: Awaited<typeof task.promise>;
  try {
    // getDocument can throw before it returns (no worker it can load), so it's inside the try.
    task = pdfjs.getDocument({
      data: bytes,
      useWorkerFetch: false,
      disableFontFace: true,
      // Nothing to render, so keep the text-only path cheap and quiet: no canvas support and no
      // warnings about standard font data the caller didn't provide.
      isOffscreenCanvasSupported: false,
      verbosity: 0,
    });
    document = await task.promise;
  } catch {
    throw new SourceError("parse_failed", READ_FAILED);
  }

  try {
    const metadata = await readMetadata(document);
    const pages: PdfTextItem[][] = [];
    let textLength = 0;
    const pageCount = Math.min(document.numPages, MAX_PDF_PAGES);

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      let items: PdfTextItem[];
      try {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        items = textItemsFromContent(content.items);
        page.cleanup();
      } catch {
        throw new SourceError("parse_failed", READ_FAILED);
      }
      pages.push(items);
      textLength += items.reduce((sum, item) => sum + item.str.length, 0);
      if (textLength > MAX_PDF_TEXT_LENGTH) break;
    }

    if (textLength < MIN_TEXT_LENGTH) throw new SourceError("parse_failed", NO_TEXT);

    const { markdown, firstPageLines } = buildPdfMarkdown(pages);
    if (markdown.length < MIN_TEXT_LENGTH) throw new SourceError("parse_failed", NO_TEXT);

    const title =
      meaningfulTitle(metadata.title) ?? titleFromFirstPage(firstPageLines) ?? titleFromPdfUrl(url);

    return {
      url,
      title,
      meta: {
        author: metadata.author,
        published: metadata.published,
        pages: document.numPages,
        arxiv: null,
      },
      markdown,
    };
  } finally {
    try {
      // Stops the worker and frees the parsed document.
      await task.destroy();
    } catch {
      // Freeing the document is best effort.
    }
  }
}

interface PdfMetadata {
  title: string | null;
  author: string | null;
  published: string | null;
}

async function readMetadata(document: {
  getMetadata: () => Promise<{ info?: unknown }>;
}): Promise<PdfMetadata> {
  try {
    const { info } = await document.getMetadata();
    const record = (info ?? {}) as Record<string, unknown>;
    const string = (value: unknown): string | null => {
      if (typeof value !== "string") return null;
      const trimmed = value.replace(/\s+/g, " ").trim();
      return trimmed || null;
    };
    return {
      title: string(record.Title),
      author: string(record.Author),
      published: pdfCreationDate(
        typeof record.CreationDate === "string" ? record.CreationDate : null,
      ),
    };
  } catch {
    return { title: null, author: null, published: null };
  }
}
