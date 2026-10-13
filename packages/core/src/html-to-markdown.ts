import TurndownService from "turndown";
import { tables, strikethrough } from "@joplin/turndown-plugin-gfm";

export function createMarkdownConverter(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });

  service.use([tables, strikethrough]);

  const tagsToRemove = [
    "script",
    "style",
    "noscript",
    "svg",
    "button",
    "img",
    "picture",
    "video",
    "audio",
    "iframe",
    "form",
    "input",
  ] as (keyof HTMLElementTagNameMap)[];

  service.remove(tagsToRemove);

  // Turndown's built-in rules (e.g. image) take precedence over service.remove,
  // so add a rule at the top of the rules list to ensure these tags are removed.
  service.addRule("removeDisallowedTags", {
    filter: tagsToRemove,
    replacement: () => "",
  });

  return service;
}

export function htmlToMarkdown(html: string): string {
  const converter = createMarkdownConverter();
  const markdown = converter.turndown(html);
  const normalized = markdown
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) {
    return "";
  }

  return `${normalized}\n`;
}
