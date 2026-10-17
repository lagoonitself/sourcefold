import { describe, expect, it } from "vitest";
import {
  captureContext,
  locateHighlight,
  overlappingIds,
  segmentsForRange,
  trimRange,
} from "../anchoring";

const TEXT =
  "Turbochargers recover waste energy. The exhaust spins a turbine, and the turbine drives a compressor. Turbo lag was the main obstacle.";

function anchor(quote: string, near = 0) {
  const start = TEXT.indexOf(quote, near);
  return { start, end: start + quote.length };
}

describe("captureContext", () => {
  it("takes the quote and up to 32 characters on each side", () => {
    const { start, end } = anchor("the turbine drives a compressor");
    const ctx = captureContext(TEXT, start, end);
    expect(ctx.quote).toBe("the turbine drives a compressor");
    expect(ctx.prefix).toHaveLength(32);
    expect(ctx.prefix).toBe(TEXT.slice(start - 32, start));
    expect(ctx.suffix).toBe(TEXT.slice(end, end + 32));
  });

  it("is shorter at the edges of the text", () => {
    const ctx = captureContext(TEXT, 0, 13);
    expect(ctx.prefix).toBe("");
    const tail = captureContext(TEXT, TEXT.length - 5, TEXT.length);
    expect(tail.suffix).toBe("");
  });
});

describe("trimRange", () => {
  it("drops the line break a triple click adds", () => {
    expect(trimRange("  hello world\n\n", 0, 15)).toEqual({ start: 2, end: 13 });
  });

  it("returns null for whitespace only or an empty range", () => {
    expect(trimRange("a   b", 1, 4)).toBeNull();
    expect(trimRange("abc", 2, 2)).toBeNull();
  });
});

describe("locateHighlight", () => {
  const quote = "the turbine drives a compressor";
  const { start, end } = anchor(quote);
  const base = { ...captureContext(TEXT, start, end), start_offset: start, end_offset: end };

  it("uses the stored offsets while the text there is the quote", () => {
    expect(locateHighlight(TEXT, base)).toEqual({ start, end });
  });

  it("finds the passage again when text was added before it", () => {
    const changed = `A new opening sentence. ${TEXT}`;
    const placed = locateHighlight(changed, base);
    expect(placed).not.toBeNull();
    expect(changed.slice(placed!.start, placed!.end)).toBe(quote);
    expect(placed!.start).toBe(start + "A new opening sentence. ".length);
  });

  it("prefers the copy with the same surroundings over a nearer copy", () => {
    const text = `the turbine drives a compressor. ${TEXT} and again ${TEXT}`;
    const placed = locateHighlight(text, { ...base, start_offset: 3, end_offset: 34 });
    // The standalone copy at 0 has other surroundings; the stored context matches a later copy.
    expect(text.slice(placed!.start - base.prefix.length, placed!.end + base.suffix.length)).toBe(
      base.prefix + quote + base.suffix,
    );
  });

  it("picks the quote nearest the stored start when the context is gone", () => {
    const text = `${quote} one. ${"x".repeat(200)} ${quote} two.`;
    const second = text.lastIndexOf(quote);
    const placed = locateHighlight(text, {
      quote,
      prefix: "unrelated text before",
      suffix: "unrelated text after",
      start_offset: second + 3,
      end_offset: second + 3 + quote.length,
    });
    expect(placed).toEqual({ start: second, end: second + quote.length });
  });

  it("returns null when the passage is gone", () => {
    expect(locateHighlight("Completely different words.", base)).toBeNull();
    expect(locateHighlight(TEXT, { ...base, quote: "" })).toBeNull();
  });

  it("re-locates across a small edit in the surroundings", () => {
    const changed = TEXT.replace("Turbochargers recover", "Turbochargers reclaim");
    const placed = locateHighlight(changed, base);
    expect(changed.slice(placed!.start, placed!.end)).toBe(quote);
  });
});

describe("segmentsForRange", () => {
  it("splits a range across text nodes (for example inside and outside a link)", () => {
    // "Read the " + "docs" (a link) + " today."
    const lengths = [9, 4, 7];
    expect(segmentsForRange(lengths, 5, 15)).toEqual([
      { index: 0, from: 5, to: 9 },
      { index: 1, from: 0, to: 4 },
      { index: 2, from: 0, to: 2 },
    ]);
  });

  it("stays inside one node when it can", () => {
    expect(segmentsForRange([10, 10], 12, 15)).toEqual([{ index: 1, from: 2, to: 5 }]);
  });

  it("is empty for an empty range", () => {
    expect(segmentsForRange([10], 4, 4)).toEqual([]);
  });
});

describe("overlappingIds", () => {
  const placed = [
    { id: "a", start: 0, end: 10 },
    { id: "b", start: 20, end: 30 },
  ];

  it("finds highlights a new range touches", () => {
    expect(overlappingIds(placed, 5, 12)).toEqual(["a"]);
    expect(overlappingIds(placed, 8, 25)).toEqual(["a", "b"]);
    expect(overlappingIds(placed, 22, 24)).toEqual(["b"]);
  });

  it("does not count ranges that only touch at an edge", () => {
    expect(overlappingIds(placed, 10, 20)).toEqual([]);
  });
});
