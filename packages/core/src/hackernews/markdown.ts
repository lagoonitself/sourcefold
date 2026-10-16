// Turns a Hacker News comment's HTML (the `text` field of the Algolia API) into Markdown.
// The markup is a small fixed set: `<p>` between paragraphs, `<a href>`, `<i>`, `<pre><code>`
// and escaped entities. Anything else is dropped.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  times: "\u00d7",
  middot: "\u00b7",
};

/** Unescapes the entities Hacker News writes into `text` (`&amp;`, `&#x27;`, `&#x2F;`, …). */
export function decodeEntities(value: string): string {
  return value.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function linkMarkdown(text: string, url: string): string {
  const label = text.trim();
  if (!url) return label;
  if (!label) return url;
  return `[${label}](${url})`;
}

function attribute(tag: string, name: string): string {
  const quoted = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  if (quoted) return decodeEntities(quoted[1] ?? "");
  const single = new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i").exec(tag);
  return single ? decodeEntities(single[1] ?? "") : "";
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

/** Converts one paragraph's inline markup. */
function inlineToMarkdown(html: string): string {
  let out = "";
  let index = 0;

  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open === -1) {
      out += decodeEntities(html.slice(index));
      break;
    }
    out += decodeEntities(html.slice(index, open));

    const close = html.indexOf(">", open);
    if (close === -1) {
      out += decodeEntities(html.slice(open));
      break;
    }

    const tag = html.slice(open + 1, close);
    index = close + 1;
    const closing = tag.startsWith("/");
    const name = (tag.replace(/^\//, "").split(/[\s/>]/)[0] ?? "").toLowerCase();

    if (name === "a") {
      if (closing) continue;
      const end = html.indexOf("</a>", index);
      const label = end === -1 ? html.slice(index) : html.slice(index, end);
      index = end === -1 ? html.length : end + 4;
      out += linkMarkdown(decodeEntities(stripTags(label)), attribute(tag, "href"));
    } else if (name === "i" || name === "em") {
      out += "*";
    } else if (name === "b" || name === "strong") {
      out += "**";
    } else if (name === "code") {
      out += "`";
    }
  }

  return out;
}

const CODE_BLOCK = /<pre>\s*<code>([\s\S]*?)<\/code>\s*<\/pre>/i;

function codeBlockToMarkdown(block: string): string {
  const match = CODE_BLOCK.exec(block);
  const code = decodeEntities(match ? match[1]! : stripTags(block))
    .replace(/\r?\n\s*$/, "")
    .replace(/^\s*\n/, "");
  return ["```", code, "```"].join("\n");
}

/**
 * Converts a Hacker News `text` field to Markdown. Paragraphs become blocks separated by one
 * blank line, links become Markdown links, `<pre><code>` becomes a fenced code block and
 * entities are unescaped. Unknown tags are dropped.
 */
/** One `<pre>` block, so a paragraph split never cuts a code sample in two. */
const PRE_BLOCK = /(<pre>[\s\S]*?<\/pre>)/i;

export function hackerNewsTextToMarkdown(html: string): string {
  if (!html.trim()) return "";

  const normalized = html.replace(/\r\n?/g, "\n").replace(/<\/?p\s*\/?>/gi, "\n\n");
  const parts: string[] = [];

  for (const segment of normalized.split(PRE_BLOCK)) {
    if (/^<pre>/i.test(segment)) {
      parts.push(codeBlockToMarkdown(segment));
      continue;
    }
    for (const raw of segment.split("\n\n")) {
      const block = raw.trim();
      if (!block) continue;
      const text = inlineToMarkdown(block)
        .replace(/[ \t]+$/gm, "")
        .trim();
      if (text) parts.push(text);
    }
  }

  return parts.join("\n\n");
}
