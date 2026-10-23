import { htmlToMarkdownAnywhere as htmlToMarkdown } from "../html-to-markdown-server";
import type { GrokipediaArticle } from "./parse";

export function grokipediaToMarkdown(
  article: GrokipediaArticle,
  _options?: { savedAt?: string },
): string {
  let bodyMarkdown = htmlToMarkdown(article.bodyHtml);

  // Unescape Turndown-escaped footnote citation markers like \[\^1\] -> [^1]
  bodyMarkdown = bodyMarkdown.replace(/\\\[\^(\d+)\\\]/g, "[^$1]");

  // Dedupe citation runs like [^76][^77][^76] -> [^76][^77] in first-seen order
  bodyMarkdown = bodyMarkdown.replace(/\[\^\d+\](?:[ \t]*\[\^\d+\])+/g, (match) => {
    const markers = match.match(/\[\^\d+\]/g);
    if (!markers || markers.length <= 1) {
      return match;
    }
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const m of markers) {
      if (!seen.has(m)) {
        seen.add(m);
        unique.push(m);
      }
    }
    return unique.join("");
  });

  // Ensure body headings start at ##
  bodyMarkdown = bodyMarkdown.replace(/^#\s+(.+)$/gm, "## $1");

  // Collapse 3+ newlines to 2
  bodyMarkdown = bodyMarkdown.replace(/\n{3,}/g, "\n\n").trim();

  const parts: string[] = [];

  if (bodyMarkdown) {
    parts.push(bodyMarkdown);
  }

  if (article.references.length > 0) {
    const referenceLines = article.references.map((ref) => {
      const trimmedTitle = ref.title.trim();
      const domainSuffix = ref.domain ? ` - ${ref.domain}` : "";
      if (!trimmedTitle || trimmedTitle === ref.url.trim()) {
        return `[^${ref.number}]: <${ref.url}>${domainSuffix}`;
      }
      const escapedTitle = trimmedTitle.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
      const formattedUrl = /[ ()]/.test(ref.url) ? `<${ref.url}>` : ref.url;
      return `[^${ref.number}]: [${escapedTitle}](${formattedUrl})${domainSuffix}`;
    });
    parts.push(`## References\n\n${referenceLines.join("\n")}`);
  }

  if (parts.length === 0) {
    return "";
  }

  return `${parts.join("\n\n")}\n`;
}
