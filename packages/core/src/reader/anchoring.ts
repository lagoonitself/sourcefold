/**
 * Pure anchoring maths for highlights (docs/dev/handoff-highlights.md, "Anchoring"). Offsets count
 * characters of the rendered body's textContent. Nothing here touches the DOM, so it is unit tested.
 */

export const CONTEXT_LENGTH = 32;

export interface Placement {
  start: number;
  end: number;
}

export interface AnchorFields {
  quote: string;
  prefix: string;
  suffix: string;
  start_offset: number;
  end_offset: number;
}

/** The quote and up to 32 characters of text on each side of it. */
export function captureContext(
  text: string,
  start: number,
  end: number,
): { quote: string; prefix: string; suffix: string } {
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + CONTEXT_LENGTH),
  };
}

/** Moves both ends inwards past whitespace (a triple click selects the line break too). */
export function trimRange(text: string, start: number, end: number): Placement | null {
  let s = Math.max(0, start);
  let e = Math.min(text.length, end);
  while (s < e && /\s/.test(text.charAt(s))) s++;
  while (e > s && /\s/.test(text.charAt(e - 1))) e--;
  return e > s ? { start: s, end: e } : null;
}

function allIndexes(text: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) return found;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return found;
    found.push(at);
    from = at + 1;
  }
}

function nearest(candidates: number[], target: number): number {
  let best = candidates[0] ?? target;
  for (const c of candidates) {
    if (Math.abs(c - target) < Math.abs(best - target)) best = c;
  }
  return best;
}

/**
 * Where a highlight sits in the current text: the stored offsets when the text there still equals
 * the quote, else `prefix + quote + suffix`, else the quote alone, each time the match nearest to
 * the stored start. Null when the passage is gone.
 */
export function locateHighlight(text: string, h: AnchorFields): Placement | null {
  const { quote } = h;
  if (!quote) return null;
  if (text.slice(h.start_offset, h.end_offset) === quote) {
    return { start: h.start_offset, end: h.end_offset };
  }
  if (h.prefix || h.suffix) {
    const hits = allIndexes(text, h.prefix + quote + h.suffix);
    if (hits.length > 0) {
      const start = nearest(
        hits.map((i) => i + h.prefix.length),
        h.start_offset,
      );
      return { start, end: start + quote.length };
    }
  }
  const hits = allIndexes(text, quote);
  if (hits.length === 0) return null;
  const start = nearest(hits, h.start_offset);
  return { start, end: start + quote.length };
}

export interface NodeSegment {
  /** Index into the list of text node lengths. */
  index: number;
  from: number;
  to: number;
}

/** Splits [start, end) over consecutive text nodes with the given lengths. */
export function segmentsForRange(lengths: number[], start: number, end: number): NodeSegment[] {
  const segments: NodeSegment[] = [];
  if (end <= start) return segments;
  let at = 0;
  for (let index = 0; index < lengths.length; index++) {
    const nodeStart = at;
    const nodeEnd = at + (lengths[index] ?? 0);
    at = nodeEnd;
    if (nodeEnd <= start) continue;
    if (nodeStart >= end) break;
    segments.push({
      index,
      from: Math.max(start, nodeStart) - nodeStart,
      to: Math.min(end, nodeEnd) - nodeStart,
    });
  }
  return segments;
}

/** Ids of text placements that overlap [start, end). */
export function overlappingIds(
  placed: ReadonlyArray<{ id: string; start: number; end: number }>,
  start: number,
  end: number,
): string[] {
  return placed.filter((p) => p.start < end && start < p.end).map((p) => p.id);
}
