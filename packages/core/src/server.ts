// Server-only: these depend on linkedom and turndown (Node).
export * from "./index";
export { createMarkdownConverter, htmlToMarkdown } from "./html-to-markdown";
export {
  GrokipediaParseError,
  parseGrokipediaHtml,
  type GrokipediaArticle,
  type GrokipediaReference,
} from "./grokipedia/parse";
export { grokipediaToMarkdown } from "./grokipedia/markdown";
export { fetchWikipediaCaptureOnServer } from "./wikipedia/server";
// Source kinds added on 2026-10-16. The server parses HTML with linkedom and reads PDFs with
// pdf.js' legacy build (the default loader).
export { fetchSourceCapture, type SourceCaptureDeps } from "./sources";
export { parseHtmlOnServer } from "./parse-html-server";
