import { parseHTML } from "linkedom";
import type { WikipediaCapture } from "../capture-types";
import { WIKIPEDIA_USER_AGENT, fetchWikipediaCapture } from "./fetch";

/** Server-side Wikipedia fetch: parses with linkedom and identifies itself with a User-Agent. */
export function fetchWikipediaCaptureOnServer(
  input: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<WikipediaCapture> {
  return fetchWikipediaCapture(input, {
    parseHtml: (html) => parseHTML(html).document as unknown as Document,
    headers: { "User-Agent": WIKIPEDIA_USER_AGENT },
    fetch: options.fetch,
    signal: options.signal,
  });
}
