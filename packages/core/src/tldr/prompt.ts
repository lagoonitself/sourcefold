// The instructions every model gets, and reading its answer back. Plain prompting, no
// provider-specific "structured output" switch: the same words work on ChatGPT, OpenRouter and
// OpenCode, and `parseTldrAnswer` is lenient about code fences and text around the JSON.
import { normalizeTldr, type Tldr } from "./types";

export const TLDR_INSTRUCTIONS = `You write TL;DRs of saved research sources, so the reader can decide in seconds whether the whole source is worth their time.

Reply with one JSON object and nothing else:
{"gist": "...", "points": ["...", "..."], "best_part": "..."}

- gist: one plain sentence, at most 30 words, that states what the source says or shows. Say the substance itself; never "This article discusses" or "The video explains".
- points: 3 to 5 key facts, claims or findings, each at most 20 words. Be concrete: keep the numbers, names and dates.
- best_part: the section name or the transcript time (like 12:30) most worth reading, with a few words on why, at most 20 words. Use null when nothing stands out.

Write in English, without Markdown. Use only what is in the text; don't add facts. When the text says parts were left out, judge from what you see.`;

/** The user message: the source as `buildTldrInput` made it. */
export function tldrUserMessage(input: string): string {
  return `Write the TL;DR of this source.\n\n<source>\n${input}\n</source>`;
}

/**
 * Reads a model's answer: the first JSON object in it (code fences and words around it are
 * ignored), checked by `normalizeTldr`. Null when there is no usable gist.
 */
export function parseTldrAnswer(answer: string): Tldr | null {
  const text = answer.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  if (start === -1) return null;
  // Try each closing brace from the last one back, so trailing chatter doesn't break JSON.parse.
  for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
    try {
      const parsed = normalizeTldr(JSON.parse(text.slice(start, end + 1)));
      if (parsed) return parsed;
    } catch {
      // keep looking
    }
  }
  return null;
}
