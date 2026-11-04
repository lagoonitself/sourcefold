import { describe, expect, it } from "vitest";
import { captureContext, deletedSpan, highlightsLostByEdit } from "./anchoring";

function textHighlight(id: string, text: string, quote: string, from = 0) {
  const start = text.indexOf(quote, from);
  return {
    id,
    kind: "text",
    image_src: null,
    ...captureContext(text, start, start + quote.length),
    start_offset: start,
    end_offset: start + quote.length,
  };
}

const none = new Set<string>();

describe("deletedSpan", () => {
  it("finds one contiguous deletion", () => {
    expect(deletedSpan("abcXYZdef", "abcdef")).toEqual({ start: 3, end: 6 });
    expect(deletedSpan("cut me. keep", "keep")).toEqual({ start: 0, end: 8 });
  });

  it("covers every place the cut could have been when its edges repeat", () => {
    // "abc XYZ def" -> "abc def" is " XYZ" cut at 3 or "XYZ " cut at 4.
    expect(deletedSpan("abc XYZ def", "abc def")).toEqual({ start: 3, end: 8 });
    // The QA case: a paragraph starting "Sponsor…" cut just before a "Sponsors" heading.
    const before = "1900s.\nSponsored: buy!\nSponsors\nAcme.";
    const after = "1900s.\nSponsors\nAcme.";
    expect(deletedSpan(before, after)).toEqual({ start: 6, end: 30 });
  });

  it("is null for insertions, several cuts and no change", () => {
    expect(deletedSpan("abc", "abcd")).toBeNull();
    expect(deletedSpan("a1b2c", "abc")).toBeNull();
    expect(deletedSpan("same", "same")).toBeNull();
  });
});

describe("highlightsLostByEdit", () => {
  const before = "Sponsored: buy our kit. Real content here. Sponsors are listed below.";
  const after = "Real content here. Sponsors are listed below.";

  // QA 2026-11-04 P2-1.
  it("drops a highlight inside the cut even when its words appear elsewhere", () => {
    const onCut = textHighlight("cut", before, "Sponsor");
    const lost = highlightsLostByEdit(
      [onCut],
      { text: before, images: none },
      { text: after, images: none },
    );
    expect(lost.map((h) => h.id)).toEqual(["cut"]);
  });

  it("keeps a highlight outside the cut on the same words", () => {
    const later = textHighlight("later", before, "Sponsor", 10);
    const lost = highlightsLostByEdit(
      [later],
      { text: before, images: none },
      { text: after, images: none },
    );
    expect(lost).toEqual([]);
  });

  it("falls back to finding the passage when the edit isn't one deletion", () => {
    const text = "one two three four";
    const kept = textHighlight("kept", text, "three");
    const gone = textHighlight("gone", text, "two");
    const lost = highlightsLostByEdit(
      [kept, gone],
      { text, images: none },
      { text: "one three", images: none },
    );
    expect(lost.map((h) => h.id)).toEqual(["gone"]);
  });

  it("ignores highlights already orphaned and handles images", () => {
    const orphan = { ...textHighlight("orphan", before, "Real"), quote: "not in the text" };
    const image = {
      ...textHighlight("img", before, "Real"),
      kind: "image",
      image_src: "https://x/a.png",
    };
    const lost = highlightsLostByEdit(
      [orphan, image],
      { text: before, images: new Set(["https://x/a.png"]) },
      { text: after, images: none },
    );
    expect(lost.map((h) => h.id)).toEqual(["img"]);
  });
});
