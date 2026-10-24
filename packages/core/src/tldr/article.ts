// The article's own TL;DR, found by code (docs/dev/PLAN-tldr.md, "The article's own TL;DR").
// Clear signals only: an encyclopedia's lead, a paper's abstract, a "TL;DR:" line, a "Key
// takeaways" section. Everything else is left to a model. Meta descriptions are never used: they
// are written for search engines and are often a fragment.
import { markdownBlocks, splitSentences, type TextBlock } from "./plain-text";
import { normalizeTldr, type Tldr } from "./types";

export interface ArticleTldrInput {
  kind: string;
  /** The source's body (between the source line and the trailing sections), as Markdown. */
  body: string;
}

const MIN_GIST = 40;
/** A "Summary" section longer than this is a plot summary or a chapter, not a TL;DR. */
const MAX_SECTION = 1800;

const TLDR_LINE =
  /^\s*(?:\*\*|__)?\s*(?:tl;?\s?dr|tldr|too long;? didn'?t read)\s*(?:\*\*|__)?\s*[:\-–—]+\s*(?:\*\*|__)?\s*(.+)$/i;
const TLDR_LINE_BOLD_COLON =
  /^\s*(?:\*\*|__)\s*(?:tl;?\s?dr|tldr)\s*[:\-–—]+\s*(?:\*\*|__)\s*(.+)$/i;
const SUMMARY_HEADINGS =
  /^(?:tl;?\s?dr|tldr|key takeaways?|key points|main points|takeaways|in brief|in short|the short version|short version|bottom line|executive summary|summary)\s*:?$/i;
const LEAD_HEADINGS = /^(?:overview|introduction|summary)$/i;

function fromSentences(text: string): Tldr | null {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return null;
  let gist = sentences[0]!;
  let rest = sentences.slice(1);
  // A very short first sentence ("Turbochargers are old.") reads better joined to the next.
  if (gist.length < MIN_GIST && rest.length > 0) {
    gist = `${gist} ${rest[0]}`;
    rest = rest.slice(1);
  }
  return normalizeTldr({ gist, points: rest.slice(0, 4), best_part: null });
}

/** Body text before `## Comments` (Reddit and Hacker News keep the post above it). */
function postPart(body: string): string {
  const at = body.search(/\n## Comments\s*\n/);
  return at === -1 ? body : body.slice(0, at);
}

/** "TL;DR: …" as a line or the start of a paragraph. */
function findTldrLine(blocks: TextBlock[], rawBody: string): Tldr | null {
  // Check the raw lines first, so a bold "**TL;DR:**" still matches before emphasis is removed.
  for (const line of rawBody.split("\n")) {
    const match = TLDR_LINE_BOLD_COLON.exec(line) ?? TLDR_LINE.exec(line);
    if (!match) continue;
    const block = blocks.find(
      (b) => b.type === "paragraph" && /^(?:tl;?\s?dr|tldr|too long)/i.test(b.text),
    );
    const text = (block?.text ?? match[1] ?? "")
      .replace(/^(?:tl;?\s?dr|tldr|too long;? didn'?t read)\s*[:\-–—]+\s*/i, "")
      .trim();
    if (text.length >= 20) return fromSentences(text);
  }
  return null;
}

/** A section headed "TL;DR", "Key takeaways", "Summary" and the like. */
function findSummarySection(blocks: TextBlock[]): Tldr | null {
  for (let i = 0; i < blocks.length; i++) {
    const heading = blocks[i]!;
    if (heading.type !== "heading" || !SUMMARY_HEADINGS.test(heading.text)) continue;
    const section: TextBlock[] = [];
    for (let j = i + 1; j < blocks.length; j++) {
      const block = blocks[j]!;
      if (block.type === "heading" && block.level <= heading.level) break;
      section.push(block);
    }
    const size = section.reduce((n, b) => n + b.text.length, 0);
    if (size === 0 || size > MAX_SECTION) continue;
    const paragraphs = section.filter((b) => b.type === "paragraph");
    const list = section.find((b) => b.type === "list");
    if (list && list.items.length > 0) {
      const gist = paragraphs[0]?.text ?? list.items[0]!;
      const points = paragraphs[0] ? list.items : list.items.slice(1);
      return normalizeTldr({ gist: splitSentences(gist)[0] ?? gist, points, best_part: null });
    }
    if (paragraphs.length > 0) return fromSentences(paragraphs.map((p) => p.text).join(" "));
  }
  return null;
}

/** The text before the first heading (or in a first "Overview" section). */
function leadText(blocks: TextBlock[]): string {
  const lead: string[] = [];
  let i = 0;
  if (blocks[0]?.type === "heading") {
    if (!LEAD_HEADINGS.test(blocks[0].text)) return "";
    i = 1;
  }
  for (; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.type === "heading") break;
    if (block.type === "paragraph") lead.push(block.text);
    if (lead.join(" ").length > 1500) break;
  }
  return lead.join(" ");
}

function sectionText(blocks: TextBlock[], name: RegExp): string {
  const at = blocks.findIndex((b) => b.type === "heading" && name.test(b.text));
  if (at === -1) return "";
  const parts: string[] = [];
  for (let i = at + 1; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.type === "heading") break;
    parts.push(block.text);
  }
  return parts.join(" ");
}

/**
 * The source's own TL;DR, or null when it has no clear one. `points` may be empty (a lead or an
 * abstract gives a gist and a few of its sentences).
 */
export function findArticleTldr({ kind, body }: ArticleTldrInput): Tldr | null {
  if (!body.trim()) return null;

  switch (kind) {
    case "wikipedia":
    case "grokipedia": {
      const blocks = markdownBlocks(body);
      const lead = leadText(blocks);
      return lead.length >= MIN_GIST ? fromSentences(lead) : null;
    }
    case "pdf": {
      const blocks = markdownBlocks(body);
      const abstract = sectionText(blocks, /^abstract$/i);
      if (abstract.length >= MIN_GIST) return fromSentences(abstract);
      // A plain PDF's text: a paragraph starting "Abstract" near the top.
      const para = blocks
        .slice(0, 40)
        .find((b) => b.type === "paragraph" && /^abstract\b[\s.:—-]*/i.test(b.text));
      const text = para?.text.replace(/^abstract\b[\s.:—-]*/i, "") ?? "";
      return text.length >= MIN_GIST ? fromSentences(text) : null;
    }
    case "reddit":
    case "substack":
    case "web":
    case "x": {
      const raw = kind === "reddit" ? postPart(body) : body;
      const blocks = markdownBlocks(raw);
      return findTldrLine(blocks, raw) ?? findSummarySection(blocks);
    }
    default:
      // YouTube, Hacker News, Bluesky and anything new: no reliable signal.
      return null;
  }
}
