import { Marked, type Token, type Tokens } from "marked";

// The readable copy of a saved file: HTML that Google Drive imports as a Google Doc (and that
// Drive can export as .docx). Built from the same Markdown file we upload to Drive, so the Doc
// always matches it. See docs/FILE-FORMAT.md, "Google Docs and Word copies".

const FRONT_MATTER = /^---\n[\s\S]*?\n---\n/;
const FOOTNOTE_DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
const FENCE = /^ {0,3}(```|~~~)/;
// A Docs page with 1 inch margins is 6.5 inches wide, which is 624 px at 96 dpi.
const PAGE_WIDTH_PX = 624;

const FONT = "font-family:Arial,Helvetica,sans-serif;";
const HEADING_STYLES: Record<number, string> = {
  1: "font-size:24pt;font-weight:bold;margin:0 0 6pt 0;",
  2: "font-size:18pt;font-weight:bold;margin:18pt 0 6pt 0;",
  3: "font-size:14pt;font-weight:bold;margin:14pt 0 4pt 0;",
  4: "font-size:12pt;font-weight:bold;margin:12pt 0 4pt 0;",
  5: "font-size:11pt;font-weight:bold;margin:10pt 0 4pt 0;",
  6: "font-size:11pt;font-weight:bold;font-style:italic;margin:10pt 0 4pt 0;",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only web and mail links survive. Anything else (javascript:, data:, relative paths) is text.
function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

// Substack's image names end in their size (`…_1630x1630.jpeg`). With it a big image can be
// scaled to the page width without downloading it.
function imageSize(url: string): { width: number; height: number } | null {
  const match = /[_-](\d{2,5})x(\d{2,5})\.[a-z0-9]{2,5}(?:$|[?#%])/i.exec(url);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return null;
  const shown = Math.min(width, PAGE_WIDTH_PX);
  return { width: shown, height: Math.max(1, Math.round((height * shown) / width)) };
}

interface Footnotes {
  definitions: Map<string, string>;
  body: string;
}

// `[^id]: text` lines (outside code fences) are taken out of the body; an indented line that
// follows continues the note.
function extractFootnotes(markdown: string): Footnotes {
  const definitions = new Map<string, string>();
  const kept: string[] = [];
  let fence: string | null = null;
  let current: string | null = null;

  for (const line of markdown.split("\n")) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1]!;
      else if (fenceMatch[1] === fence) fence = null;
    }
    const definition = fence === null && !fenceMatch ? FOOTNOTE_DEFINITION.exec(line) : null;
    if (definition) {
      current = definition[1]!;
      if (!definitions.has(current)) definitions.set(current, definition[2]!.trim());
      else current = null;
      continue;
    }
    if (current !== null && /^(?: {2,}|\t)\S/.test(line)) {
      definitions.set(current, `${definitions.get(current)} ${line.trim()}`);
      continue;
    }
    current = null;
    kept.push(line);
  }
  return { definitions, body: kept.join("\n") };
}

type Flagged = Tokens.Paragraph & {
  role?: "subtitle" | "source" | "figure" | "caption";
};

function isOnlyImages(token: Tokens.Paragraph): boolean {
  const meaningful = token.tokens.filter(
    (t) => !(t.type === "br" || (t.type === "text" && t.raw.trim() === "")),
  );
  return meaningful.length > 0 && meaningful.every((t) => t.type === "image");
}

function isOnlyEmphasis(token: Tokens.Paragraph): boolean {
  return token.tokens.length === 1 && token.tokens[0]!.type === "em";
}

// An image paragraph is a figure; the italic paragraph right below it is its caption.
function markFigures(tokens: Token[]): void {
  let previousWasFigure = false;
  for (const token of tokens) {
    if (token.type === "space") continue;
    if (token.type === "paragraph") {
      const paragraph = token as Flagged;
      if (isOnlyImages(paragraph)) {
        paragraph.role = "figure";
        previousWasFigure = true;
        continue;
      }
      if (previousWasFigure && isOnlyEmphasis(paragraph)) paragraph.role = "caption";
    } else if (token.type === "blockquote") {
      markFigures((token as Tokens.Blockquote).tokens);
    } else if (token.type === "list") {
      for (const itemToken of (token as Tokens.List).items) markFigures(itemToken.tokens);
    }
    previousWasFigure = false;
  }
}

const isSpace = (token: Token | undefined) => token?.type === "space";

/**
 * Turns a Sourcefold Markdown file (front matter, `# Title`, optional `*subtitle*`, the
 * `> Saved from …` line, the body, an optional `## My note`) into the HTML Drive imports as a
 * Google Doc: title, a small muted source line, then the body with images where they were.
 */
export function buildGoogleDocHtml(markdownFile: string): string {
  const text = markdownFile.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const { definitions, body } = extractFootnotes(text.replace(FRONT_MATTER, ""));

  // Footnotes are numbered 1, 2, 3 … in the order they are first used. Docs import doesn't keep
  // anchors reliably, so a marker is a plain superscript number and the notes follow as a list.
  const numbers = new Map<string, number>();
  const marked = new Marked({
    gfm: true,
    extensions: [
      {
        name: "footnoteRef",
        level: "inline",
        start: (src: string) => src.indexOf("[^"),
        tokenizer(src: string) {
          const match = /^\[\^([^\]\s]+)\]/.exec(src);
          if (!match) return undefined;
          return { type: "footnoteRef", raw: match[0], id: match[1]! } as Tokens.Generic;
        },
        renderer(token: Tokens.Generic) {
          const id = token.id as string;
          if (!definitions.has(id)) return escapeHtml(token.raw);
          if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
          return `<sup>${numbers.get(id)}</sup>`;
        },
      },
    ],
    renderer: {
      heading({ tokens, depth }) {
        return `<h${depth} style="${FONT}${HEADING_STYLES[depth]}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      paragraph(token) {
        const inner = this.parser.parseInline(token.tokens);
        switch ((token as Flagged).role) {
          case "subtitle":
            return `<p style="${FONT}font-size:14pt;color:#555555;margin:0 0 8pt 0;">${inner}</p>\n`;
          case "source":
            return `<p style="${FONT}font-size:9pt;color:#777777;margin:0 0 14pt 0;">${inner}</p>\n`;
          case "figure":
            return `<p style="${FONT}text-align:center;margin:12pt 0 2pt 0;">${inner}</p>\n`;
          case "caption":
            return `<p style="${FONT}text-align:center;font-size:9pt;color:#666666;margin:0 0 12pt 0;">${inner}</p>\n`;
          default:
            return `<p style="${FONT}font-size:11pt;line-height:1.5;margin:0 0 8pt 0;">${inner}</p>\n`;
        }
      },
      // No raw HTML ever reaches the Doc: it is shown as the text it is.
      html(token) {
        const escaped = escapeHtml(token.text);
        return token.block ? `<p>${escaped}</p>\n` : escaped;
      },
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const url = safeUrl(href);
        return url ? `<a href="${escapeHtml(url)}">${inner}</a>` : inner;
      },
      image({ href, text }) {
        const url = safeUrl(href);
        if (!url || url.startsWith("mailto:")) return escapeHtml(text);
        const parsed = new URL(url);
        if (parsed.pathname.toLowerCase().endsWith(".mp4")) {
          const gifMatch =
            parsed.protocol === "https:" &&
            parsed.hostname === "video.twimg.com" &&
            /^\/tweet_video\/([A-Za-z0-9_-]{1,100})\.mp4$/.exec(parsed.pathname);
          if (gifMatch) {
            return `<a href="${escapeHtml(url)}"><img src="https://pbs.twimg.com/tweet_video_thumb/${gifMatch[1]}.jpg" alt="${escapeHtml(text)}" style="max-width:${PAGE_WIDTH_PX}px;"></a>`;
          }
          return `<a href="${escapeHtml(url)}">${escapeHtml(text.trim() || "Video")}</a>`;
        }
        const size = imageSize(url);
        const dimensions = size ? ` width="${size.width}" height="${size.height}"` : "";
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${dimensions} style="max-width:${PAGE_WIDTH_PX}px;">`;
      },
      code({ text: code }) {
        return `<pre style="font-family:'Courier New',monospace;font-size:10pt;background-color:#f3f3f3;padding:6pt;"><code>${escapeHtml(code)}</code></pre>\n`;
      },
      codespan({ text: code }) {
        return `<code style="font-family:'Courier New',monospace;font-size:10pt;">${escapeHtml(code)}</code>`;
      },
      checkbox({ checked }) {
        return checked ? "☑ " : "☐ ";
      },
    },
  });

  const tokens = marked.lexer(body);

  // Title, subtitle and source line sit at the top in that order; each is optional.
  const top: Token[] = [];
  const first = tokens.findIndex((t) => !isSpace(t));
  if (
    first !== -1 &&
    tokens[first]!.type === "heading" &&
    (tokens[first] as Tokens.Heading).depth === 1
  ) {
    top.push(tokens[first]!);
    let at = first + 1;
    const skipSpace = () => {
      while (isSpace(tokens[at])) at++;
    };
    skipSpace();
    const next = tokens[at];
    if (next?.type === "paragraph" && isOnlyEmphasis(next as Tokens.Paragraph)) {
      (next as Flagged).role = "subtitle";
      top.push(next);
      at++;
      skipSpace();
    }
    const quote = tokens[at];
    if (quote?.type === "blockquote" && /^>\s*Saved from\b/.test(quote.raw)) {
      const line = (quote as Tokens.Blockquote).tokens.find((t) => t.type === "paragraph");
      if (line) {
        (line as Flagged).role = "source";
        top.push(line);
        at++;
      }
    }
    tokens.splice(first, at - first);
  }

  // A trailing "## References" is the list of footnote definitions; the Notes list replaces it.
  if (definitions.size > 0) {
    let last = tokens.length - 1;
    while (last >= 0 && isSpace(tokens[last])) last--;
    const tail = tokens[last];
    if (tail?.type === "heading" && /^references$/i.test((tail as Tokens.Heading).text.trim())) {
      tokens.splice(last);
    }
  }

  markFigures(tokens);
  let html = marked.parser(top) + marked.parser(tokens);

  if (numbers.size > 0) {
    const notes = [...numbers.keys()]
      .map((id) => `<li>${marked.parseInline(definitions.get(id) ?? "")}</li>`)
      .join("\n");
    html +=
      `<h2 style="${FONT}${HEADING_STYLES[2]}">Notes</h2>\n` +
      `<ol style="${FONT}font-size:10pt;">\n${notes}\n</ol>\n`;
  }

  // Every tag below comes from the renderer: text is escaped, so a literal "<table>" can't match.
  html = html
    .replace(
      /<blockquote>/g,
      `<blockquote style="${FONT}margin:0 0 8pt 24px;padding-left:12px;border-left:3px solid #cccccc;color:#444444;">`,
    )
    .replace(
      /<table>/g,
      `<table border="1" cellpadding="6" cellspacing="0" style="${FONT}font-size:10pt;border-collapse:collapse;margin:0 0 10pt 0;">`,
    );

  return (
    `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n</head>\n` +
    `<body style="${FONT}font-size:11pt;color:#222222;">\n${html}</body>\n</html>\n`
  );
}
