/**
 * Snippets from the search index mark each matched word as `\u0002word\u0003`. The UI shows the
 * marked words in bold; a snippet is never rendered as HTML, so nothing in a saved page can
 * inject markup into the search box.
 */

export interface SnippetSegment {
  text: string;
  /** True for a word the search matched. */
  bold: boolean;
}

const START = "\u0002";
const END = "\u0003";

function tidy(text: string): string {
  // Line breaks inside a passage become spaces so the two-line clamp reads as running text.
  return text.replace(/\s+/g, " ");
}

/** Splits a snippet on its match markers. Stray or unclosed markers never leak into the text. */
export function splitSnippet(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let bold = false;
  let buffer = "";
  const flush = () => {
    const text = tidy(buffer);
    buffer = "";
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last && last.bold === bold) last.text += text;
    else segments.push({ text, bold });
  };
  for (const ch of snippet) {
    if (ch === START) {
      flush();
      bold = true;
    } else if (ch === END) {
      flush();
      bold = false;
    } else {
      buffer += ch;
    }
  }
  flush();
  // Whitespace at the very start and end is not worth a line of its own.
  if (segments.length > 0) {
    segments[0].text = segments[0].text.replace(/^ /, "");
    const last = segments[segments.length - 1];
    last.text = last.text.replace(/ $/, "");
  }
  return segments.filter((s) => s.text.length > 0);
}

/** The snippet with its markers removed. */
export function plainSnippet(snippet: string): string {
  return splitSnippet(snippet)
    .map((s) => s.text)
    .join("");
}

/** 75 becomes "1:15" and 3725 becomes "1:02:05". */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
