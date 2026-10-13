import { htmlToMarkdown } from "../html-to-markdown.js";
import type { GrokipediaArticle } from "./parse.js";

export function grokipediaToMarkdown(
  article: GrokipediaArticle,
  options: { savedAt: string },
): string {
  let bodyMarkdown = htmlToMarkdown(article.bodyHtml);

  // Unescape Turndown-escaped footnote citation markers like \[\^1\] -> [^1]
  bodyMarkdown = bodyMarkdown.replace(/\\\[\^(\d+)\\\]/g, "[^$1]");

  // Collapse consecutive duplicated citation markers like [^1][^1] or [^1] [^1] -> [^1]
  bodyMarkdown = bodyMarkdown.replace(/(\[\^\d+\])(?:\s*\1)+/g, "$1");

  bodyMarkdown = bodyMarkdown.trim();

  const parts: string[] = [
    `# ${article.title}`,
    `> Saved from Grokipedia on ${options.savedAt}. Grokipedia articles change; see the live page and its edit history: ${article.url}`,
  ];

  if (bodyMarkdown) {
    parts.push(bodyMarkdown);
  }

  if (article.references.length > 0) {
    const referenceLines = article.references.map(
      (ref) => `[^${ref.number}]: [${ref.title}](${ref.url}) - ${ref.domain}`,
    );
    parts.push(`## References\n\n${referenceLines.join("\n")}`);
  }

  return `${parts.join("\n\n")}\n`;
}
