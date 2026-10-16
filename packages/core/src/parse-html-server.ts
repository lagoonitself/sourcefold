import { parseHTML } from "linkedom";

/** Parses HTML on the server (linkedom), for extractors that take a `parseHtml` function. */
export function parseHtmlOnServer(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}
