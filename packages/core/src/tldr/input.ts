// What a model is given to write a TL;DR (docs/dev/PLAN-tldr.md, "Writing a TL;DR"). Kept small
// on purpose: a Grokipedia article is about 200 KB and the user's plan or credits pay for every
// token, so a long source is cut down to its outline, its lead and the start of each section; a
// long transcript to evenly spaced passages with their times.
import { inlineToText, markdownBlocks, type TextBlock } from "./plain-text";

export const TLDR_INPUT_MAX = 24_000;
const LEAD_MAX = 3_000;
const SECTION_START_MAX = 700;

export interface TldrInputSource {
  title: string;
  kind: string;
  /** Front matter fields (author, channel, published, duration, …), as the reader parsed them. */
  frontMatter?: Record<string, string>;
  /** The body as Markdown. */
  body: string;
}

export interface TldrInput {
  text: string;
  /** True when the body didn't fit and was cut down. */
  shortened: boolean;
}

const KIND_NAMES: Record<string, string> = {
  grokipedia: "Grokipedia article",
  wikipedia: "Wikipedia article",
  substack: "Substack post",
  x: "X (Twitter) thread",
  youtube: "YouTube video transcript",
  web: "Web page",
  reddit: "Reddit thread",
  pdf: "PDF document",
  hackernews: "Hacker News thread",
  bluesky: "Bluesky thread",
};

const HEADER_FIELDS: Array<[string, string]> = [
  ["author", "Author"],
  ["channel", "Channel"],
  ["publication", "Publication"],
  ["subreddit", "Subreddit"],
  ["published", "Published"],
  ["posted", "Posted"],
  ["duration", "Duration"],
  ["pages", "Pages"],
];

function header(source: TldrInputSource): string {
  const lines = [`Title: ${source.title.trim() || "Untitled"}`];
  lines.push(`Type: ${KIND_NAMES[source.kind] ?? "Saved source"}`);
  for (const [key, label] of HEADER_FIELDS) {
    const value = source.frontMatter?.[key]?.trim();
    if (value) lines.push(`${label}: ${value}`);
  }
  return lines.join("\n");
}

function blockToText(block: TextBlock): string {
  if (block.type === "heading") return `${"#".repeat(Math.max(2, block.level))} ${block.text}`;
  if (block.type === "list") return block.items.map((item) => `- ${item}`).join("\n");
  return block.text;
}

function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  return `${stop > max * 0.5 ? cut.slice(0, stop + 1) : cut} …`;
}

/** Transcript paragraphs start with `[m:ss](https://youtu.be/…)`; keep the time as `[m:ss]`. */
function transcriptParagraphs(body: string): { transcript: string[]; description: string } {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const transcript: string[] = [];
  const description: string[] = [];
  let section: "transcript" | "description" | "other" = "other";
  let current: string[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const raw = current.join(" ");
    current = [];
    // "[12:30]" survives inlineToText: only all-digit "[12]" citations are dropped.
    const text = inlineToText(raw.replace(/^\[(\d{1,2}(?::\d{2}){1,2})\]\([^)]*\)\s*/, "[$1] "));
    if (!text) return;
    if (section === "transcript") transcript.push(text);
    else if (section === "description") description.push(text);
  };
  for (const line of lines) {
    const heading = /^##\s+(.*)$/.exec(line.trim());
    if (heading) {
      flush();
      const name = heading[1]!.trim().toLowerCase();
      section =
        name === "transcript" ? "transcript" : name === "description" ? "description" : "other";
      continue;
    }
    if (!line.trim()) flush();
    else current.push(line.trim());
  }
  flush();
  return { transcript, description: description.join("\n") };
}

function transcriptInput(body: string, budget: number): { text: string; shortened: boolean } {
  const { transcript, description } = transcriptParagraphs(body);
  if (transcript.length === 0) return { text: "", shortened: false };
  const desc = description ? `## Description\n${clipText(description, 1_200)}\n\n` : "";
  const room = budget - desc.length - 40;
  const full = transcript.join("\n\n");
  if (full.length <= room) {
    return { text: `${desc}## Transcript\n${full}`, shortened: description.length > 1_200 };
  }
  // Evenly spaced passages from start to end, so the TL;DR covers the whole video.
  const average = full.length / transcript.length;
  const count = Math.max(1, Math.floor(room / (average + 2)));
  const step = transcript.length / count;
  const picked: string[] = [];
  let used = 0;
  for (let k = 0; k < count; k++) {
    const paragraph = transcript[Math.min(transcript.length - 1, Math.floor(k * step))]!;
    if (used + paragraph.length + 2 > room) break;
    picked.push(paragraph);
    used += paragraph.length + 2;
  }
  return {
    text: `${desc}## Transcript (evenly spaced passages; the rest is left out)\n${picked.join("\n\n")}`,
    shortened: true,
  };
}

function articleInput(body: string, budget: number): { text: string; shortened: boolean } {
  const blocks = markdownBlocks(body);
  const full = blocks.map(blockToText).join("\n\n");
  if (full.length <= budget) return { text: full, shortened: false };

  // The lead: blocks before the second heading (or the first, when the body starts without one).
  const firstHeading = blocks.findIndex((b, i) => b.type === "heading" && i > 0);
  const leadBlocks = blocks.slice(0, firstHeading === -1 ? blocks.length : firstHeading);
  const lead = clipText(leadBlocks.map(blockToText).join("\n\n"), LEAD_MAX);

  const outline = blocks
    .filter((b) => b.type === "heading")
    .map((b) => `${"  ".repeat(Math.max(0, b.level - 2))}- ${b.text}`)
    .join("\n");
  const outlinePart = clipText(outline, 3_000);

  // Then the start of each section, in order, while there is room.
  const parts: string[] = [];
  let used = lead.length + outlinePart.length + 120;
  const rest = blocks.slice(leadBlocks.length);
  for (let i = 0; i < rest.length; i++) {
    const block = rest[i]!;
    if (block.type !== "heading") continue;
    const next = rest[i + 1];
    const start = next && next.type !== "heading" ? clipText(next.text, SECTION_START_MAX) : "";
    const piece = start ? `${blockToText(block)}\n${start}` : blockToText(block);
    if (used + piece.length + 2 > budget) break;
    parts.push(piece);
    used += piece.length + 2;
  }

  return {
    text: [
      lead,
      `## Outline of the whole text\n${outlinePart}`,
      `## Start of each section (the rest is left out)\n\n${parts.join("\n\n")}`,
    ].join("\n\n"),
    shortened: true,
  };
}

/**
 * The text sent to a model: a short header (title, type, author, date) and the body, cut down to
 * at most `max` characters when it is long.
 */
export function buildTldrInput(source: TldrInputSource, max = TLDR_INPUT_MAX): TldrInput {
  const head = header(source);
  const budget = Math.max(2_000, max - head.length - 2);
  const transcript = source.kind === "youtube" ? transcriptInput(source.body, budget) : null;
  const body = transcript && transcript.text ? transcript : articleInput(source.body, budget);
  return { text: `${head}\n\n${body.text}`.slice(0, max), shortened: body.shortened };
}
