// Parses YouTube's timedtext caption files. Two forms come back from the same address:
// - the default: `<transcript><text start="1.2" dur="2.16">…</text></transcript>` (seconds),
// - srv3 (`fmt=srv3`): `<timedtext format="3"><body><p t="1200" d="2160">…</p>` (milliseconds),
//   where auto-generated captions split words into `<s>` children.
// Method from jdepoix/youtube-transcript-api (MIT).

export interface CaptionSegment {
  /** Seconds from the start of the video. */
  start: number;
  /** Seconds. */
  duration: number;
  text: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Caption text as a reader sees it. The XML escapes once and YouTube often escapes the caption
 * text itself as well (`&amp;#39;`), so entities are decoded twice; tags (`<font>`, `<i>`, srv3
 * word spans) are dropped and whitespace collapsed.
 */
export function cleanCaptionText(raw: string): string {
  const once = decodeEntities(raw.replace(/<[^>]*>/g, ""));
  return decodeEntities(once)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? match[1]! : null;
}

/** Reads either timedtext form. Segments with no text are dropped; the order is by start. */
export function parseTimedText(xml: string): CaptionSegment[] {
  const segments: CaptionSegment[] = [];

  for (const match of xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const start = Number(attribute(match[1]!, "start"));
    const duration = Number(attribute(match[1]!, "dur") ?? "0");
    const text = cleanCaptionText(match[2]!);
    if (text && Number.isFinite(start)) {
      segments.push({ start, duration: Number.isFinite(duration) ? duration : 0, text });
    }
  }

  if (segments.length === 0) {
    for (const match of xml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
      const start = Number(attribute(match[1]!, "t")) / 1000;
      const duration = Number(attribute(match[1]!, "d") ?? "0") / 1000;
      const text = cleanCaptionText(match[2]!);
      if (text && Number.isFinite(start)) {
        segments.push({ start, duration: Number.isFinite(duration) ? duration : 0, text });
      }
    }
  }

  return segments.sort((a, b) => a.start - b.start);
}
