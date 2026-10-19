import type { SourceExtractResult } from "../capture-types";
import { SourceError, type SourceFetch, type SourceFetchResponse } from "../source-fetch";
import { parseArxivLink } from "../source-links";
import { arxivHtmlToCapture } from "./arxiv";
import { pdfToCapture, type LoadPdfJs } from "./pdf";

// Downloads a PDF (or a paper's arXiv HTML version) and turns it into a capture. All network
// access goes through the caller's `SourceFetch`, so tests run on saved fixtures and the desktop
// app uses its own connection.

export interface PdfFetchOptions {
  fetch: SourceFetch;
  parseHtml: (html: string) => Document;
  /** Defaults to pdf.js' legacy build. */
  loadPdfJs?: LoadPdfJs;
  signal?: AbortSignal;
}

/** The most a PDF may weigh before it is refused. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

const MESSAGES = {
  not_found: "Couldn't find that PDF. Check the link.",
  blocked: "The site refused the request. Try again later.",
  fetch_failed: "Couldn't download the PDF. Check your connection and try again.",
  too_large: "This PDF is over 50 MB.",
  not_pdf: "This link isn't a PDF.",
} as const;

/**
 * Fetches a link as a PDF. arXiv links try arXiv's HTML version first and fall back to the PDF,
 * with the paper's title, authors and date taken from arXiv's API when available.
 */
export async function fetchPdfCapture(
  url: string,
  options: PdfFetchOptions,
): Promise<SourceExtractResult> {
  const arxiv = parseArxivLink(url);
  if (arxiv) return fetchArxiv(arxiv, options);
  return fetchPlain(url, options);
}

async function fetchArxiv(
  arxiv: { id: string; version: string | null; url: string },
  options: PdfFetchOptions,
): Promise<SourceExtractResult> {
  const suffix = arxiv.version ?? "";

  const html = await tryText(`https://arxiv.org/html/${arxiv.id}${suffix}`, options);
  if (html !== null) {
    try {
      const capture = arxivHtmlToCapture(html, arxiv.id, options.parseHtml);
      const paper = await readArxivMetadata(arxiv.id, options);
      if (paper) {
        if (paper.title) capture.title = paper.title.slice(0, 500);
        if (!capture.meta.author && paper.authors) capture.meta.author = paper.authors;
        if (paper.published) capture.meta.published = paper.published;
      }
      if (capture.title) {
        return { status: "ok", kind: "pdf", capture };
      }
    } catch {
      // No usable HTML version; save the PDF instead.
    }
  }

  const pdfUrl = `https://arxiv.org/pdf/${arxiv.id}${suffix}`;
  const response = await send(options, { url: pdfUrl, responseType: "bytes" });
  ensureOk(response.status);
  const bytes = checkedBytes(response);
  assertPdf(bytes, response.headers);

  const capture = await pdfToCapture(bytes, response.url || pdfUrl, {
    loadPdfJs: options.loadPdfJs,
  });
  capture.url = arxiv.url;
  capture.meta.arxiv = arxiv.id;

  const paper = await readArxivMetadata(arxiv.id, options);
  if (paper) {
    if (paper.title) capture.title = paper.title.slice(0, 500);
    if (paper.authors) capture.meta.author = paper.authors;
    if (paper.published) capture.meta.published = paper.published;
  }

  return { status: "ok", kind: "pdf", capture };
}

async function fetchPlain(url: string, options: PdfFetchOptions): Promise<SourceExtractResult> {
  const response = await send(options, { url, responseType: "bytes" });
  ensureOk(response.status);
  const bytes = checkedBytes(response);
  assertPdf(bytes, response.headers);

  const capture = await pdfToCapture(bytes, response.url || url, {
    loadPdfJs: options.loadPdfJs,
  });
  return { status: "ok", kind: "pdf", capture };
}

// ---------------------------------------------------------------------------------------------
// Requests and answers

async function send(
  options: PdfFetchOptions,
  request: { url: string; responseType?: "text" | "bytes" },
): Promise<SourceFetchResponse> {
  try {
    return await options.fetch({ ...request, signal: options.signal });
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError("fetch_failed", MESSAGES.fetch_failed);
  }
}

/** Returns the body text of a 200 response, or null for anything else (the PDF path carries on). */
async function tryText(url: string, options: PdfFetchOptions): Promise<string | null> {
  try {
    const response = await send(options, { url });
    return response.status === 200 ? response.text : null;
  } catch {
    return null;
  }
}

function ensureOk(status: number): void {
  if (status >= 200 && status < 300) return;
  if (status === 404 || status === 410) throw new SourceError("not_found", MESSAGES.not_found);
  if (status === 401 || status === 403 || status === 407 || status === 429) {
    throw new SourceError("blocked", MESSAGES.blocked);
  }
  if (status >= 500 && status <= 599) {
    throw new SourceError(
      "fetch_failed",
      `The site answered with an error (HTTP ${status}). It may be down; try again later.`,
    );
  }
  throw new SourceError("fetch_failed", `The site answered HTTP ${status} instead of the page.`);
}

function checkedBytes(response: SourceFetchResponse): Uint8Array {
  const declared = Number(response.headers["content-length"] ?? "");
  if (Number.isFinite(declared) && declared > MAX_PDF_BYTES) {
    throw new SourceError("too_large", MESSAGES.too_large);
  }
  const bytes = response.bytes ?? new Uint8Array();
  if (bytes.length > MAX_PDF_BYTES) throw new SourceError("too_large", MESSAGES.too_large);
  return bytes;
}

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

function assertPdf(bytes: Uint8Array, headers: Record<string, string>): void {
  if (/pdf/i.test(headers["content-type"] ?? "")) return;
  if (startsWithPdfMagic(bytes)) return;
  throw new SourceError("parse_failed", MESSAGES.not_pdf);
}

// ---------------------------------------------------------------------------------------------
// arXiv's Atom API (best effort: it only refines the title, authors and date)

interface ArxivMetadata {
  title: string | null;
  authors: string | null;
  published: string | null;
}

async function readArxivMetadata(
  id: string,
  options: PdfFetchOptions,
): Promise<ArxivMetadata | null> {
  try {
    const response = await send(options, {
      url: `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`,
    });
    if (response.status !== 200 || !response.text) return null;
    return parseAtomEntry(response.text);
  } catch {
    return null;
  }
}

/** Reads the first `<entry>` of arXiv's Atom feed. Exported for its own test. */
export function parseAtomEntry(xml: string): ArxivMetadata | null {
  const entry = /<entry\b[^>]*>([\s\S]*?)<\/entry>/i.exec(xml)?.[1];
  if (!entry) return null;

  const title = decodeXml(tagText(entry, "title")).replace(/\s+/g, " ").trim();
  const authors = Array.from(entry.matchAll(/<name>([\s\S]*?)<\/name>/gi))
    .map((match) => decodeXml(match[1]!).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ");
  const published =
    /^\d{4}-\d{2}-\d{2}/.exec(decodeXml(tagText(entry, "published")).trim())?.[0] ?? null;

  return {
    title: title || null,
    authors: authors || null,
    published,
  };
}

function tagText(xml: string, name: string): string {
  return new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml)?.[1] ?? "";
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits: string) => safeCodePoint(Number(digits)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(value: number): string {
  return Number.isFinite(value) && value > 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : "";
}
