// Turns caption segments into the saved transcript (docs/FILE-FORMAT.md, "YouTube").

import { youTubeTimestampUrl } from "../source-links";
import type { CaptionSegment } from "./timedtext";

/** A paragraph breaks at the end of a sentence once it has run this long… */
const SOFT_PARAGRAPH_SECONDS = 45;
/** …or at a pause this long (auto-generated captions often have no punctuation)… */
const PAUSE_SECONDS = 2;
/** …and always by this point. */
const HARD_PARAGRAPH_SECONDS = 90;

/** `m:ss`, or `h:mm:ss` from an hour on. */
export function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export interface TranscriptParagraph {
  start: number;
  text: string;
}

function endsSentence(text: string): boolean {
  return /[.!?…]["'”’)\]]*$/.test(text);
}

/** Groups caption segments into readable paragraphs of about 45–90 seconds. */
export function transcriptParagraphs(segments: CaptionSegment[]): TranscriptParagraph[] {
  const paragraphs: TranscriptParagraph[] = [];
  let current: { start: number; parts: string[] } | null = null;
  let previousEnd = 0;

  for (const segment of segments) {
    if (current) {
      const elapsed = segment.start - current.start;
      const last = current.parts[current.parts.length - 1]!;
      const paused = segment.start - previousEnd >= PAUSE_SECONDS;
      if (
        elapsed >= HARD_PARAGRAPH_SECONDS ||
        (elapsed >= SOFT_PARAGRAPH_SECONDS && (endsSentence(last) || paused))
      ) {
        paragraphs.push({ start: current.start, text: current.parts.join(" ") });
        current = null;
      }
    }
    if (current) {
      current.parts.push(segment.text);
    } else {
      current = { start: segment.start, parts: [segment.text] };
    }
    previousEnd = Math.max(previousEnd, segment.start + segment.duration);
  }

  if (current) paragraphs.push({ start: current.start, text: current.parts.join(" ") });
  return paragraphs;
}

/** Keeps caption text from being read as Markdown formatting. */
function escapeInline(text: string): string {
  return text.replace(/([\\`*<])/g, "\\$1");
}

/** A description line starting with a chapter time (`1:23 Intro`) links to that moment. */
const CHAPTER_LINE = /^(\d{1,2}(?::\d{2}){1,2})(\s.*)$/;

function chapterSeconds(stamp: string): number {
  return stamp.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

function descriptionMarkdown(videoId: string, description: string): string {
  return description
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const chapter = line.match(CHAPTER_LINE);
      if (chapter) {
        const url = youTubeTimestampUrl(videoId, chapterSeconds(chapter[1]!));
        return `[${chapter[1]}](${url})${escapeInline(chapter[2]!)}`;
      }
      // A line that Markdown would turn into a heading, quote or list stays plain text.
      return escapeInline(line)
        .replace(/^([#>+-])(\s)/, "\\$1$2")
        .replace(/^(\d+)([.)])(\s)/, "$1\\$2$3");
    })
    .join("\n\n");
}

/** The body: `## Transcript`, then `## Description` when the video has one. */
export function youTubeBodyMarkdown(
  videoId: string,
  segments: CaptionSegment[],
  description: string | null | undefined,
): string {
  const transcript = transcriptParagraphs(segments)
    .map(
      (paragraph) =>
        `[${formatTimestamp(paragraph.start)}](${youTubeTimestampUrl(videoId, paragraph.start)}) ${escapeInline(paragraph.text)}`,
    )
    .join("\n\n");

  const blocks = ["## Transcript", transcript];
  const about = description ? descriptionMarkdown(videoId, description) : "";
  if (about) blocks.push("## Description", about);
  return blocks.join("\n\n");
}
