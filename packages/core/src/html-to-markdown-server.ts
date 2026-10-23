import { parseHTML } from "linkedom";
import { htmlToMarkdown } from "./html-to-markdown";

let rowsPatched = false;

// The tables plugin reads `table.rows`, which linkedom doesn't implement.
function patchTableRows(table: Element): void {
  if (rowsPatched) return;
  rowsPatched = true;
  Object.defineProperty(Object.getPrototypeOf(table), "rows", {
    configurable: true,
    get(this: Element) {
      if (this.localName !== "table") return undefined;
      return Array.from(this.querySelectorAll("tr")).filter((tr) => tr.closest("table") === this);
    },
  });
}

/**
 * `htmlToMarkdown` for code that also runs where there is no DOM, such as the extension's
 * background worker: Turndown parses a string with the page's DOM, so this hands it a tree
 * parsed with linkedom instead.
 */
export function htmlToMarkdownAnywhere(html: string): string {
  if (typeof document !== "undefined") return htmlToMarkdown(html);
  const { document: doc } = parseHTML("<!doctype html><html><body></body></html>");
  const root = doc.createElement("div");
  root.innerHTML = html;
  patchTableRows(doc.createElement("table") as unknown as Element);
  return htmlToMarkdown(root as unknown as HTMLElement);
}
