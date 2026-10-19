import { describe, expect, it } from "vitest";
import type { Highlight } from "@sourcefold/core";
import { canEditText, lostHighlights, removalMessage } from "../removal";

const TEXT =
  "Intro line. Buy my course today and get a discount. The engine makes power. Thanks for reading.";

function highlight(quote: string, overrides: Partial<Highlight> = {}): Highlight {
  const start = TEXT.indexOf(quote);
  return {
    id: quote,
    item_id: "item",
    kind: "text",
    quote,
    prefix: TEXT.slice(Math.max(0, start - 20), start),
    suffix: TEXT.slice(start + quote.length, start + quote.length + 20),
    start_offset: start,
    end_offset: start + quote.length,
    image_src: null,
    note: null,
    seconds: null,
    cited: [],
    created_at: "2026-10-19T10:00:00Z",
    updated_at: "2026-10-19T10:00:00Z",
    ...overrides,
  };
}

const view = (text: string, images: string[] = []) => ({ text, images: new Set(images) });

describe("canEditText", () => {
  it("allows saved pages and transcripts, not notes, images or X threads", () => {
    for (const kind of ["grokipedia", "wikipedia", "substack", "youtube", "web", "reddit", "pdf"]) {
      expect(canEditText(kind)).toBe(true);
    }
    for (const kind of ["note", "image", "x"]) expect(canEditText(kind)).toBe(false);
  });
});

describe("lostHighlights", () => {
  const sale = highlight("Buy my course today and get a discount.");
  const engine = highlight("The engine makes power.");

  it("finds the highlights whose text was cut out and keeps the rest", () => {
    const after = TEXT.replace(" Buy my course today and get a discount.", "");
    const lost = lostHighlights([sale, engine], view(TEXT), view(after));
    expect(lost.map((h) => h.id)).toEqual([sale.id]);
  });

  it("keeps a highlight that moved because earlier text was cut", () => {
    const after = TEXT.replace("Intro line. ", "");
    expect(lostHighlights([sale, engine], view(TEXT), view(after))).toEqual([]);
  });

  it("does not count a highlight that was already unplaced", () => {
    const orphan = highlight("Words that are not here at all.", {
      start_offset: 0,
      end_offset: 31,
    });
    expect(lostHighlights([orphan], view(TEXT), view(TEXT.slice(20)))).toEqual([]);
  });

  it("counts an image highlight when the image is gone from the text", () => {
    const image = highlight("", { kind: "image", image_src: "https://example.com/a.png" });
    const kept = highlight("", { kind: "image", image_src: "https://example.com/b.png", id: "b" });
    const before = view(TEXT, ["https://example.com/a.png", "https://example.com/b.png"]);
    const after = view(TEXT, ["https://example.com/b.png"]);
    expect(lostHighlights([image, kept], before, after).map((h) => h.id)).toEqual([image.id]);
  });
});

describe("removalMessage", () => {
  it("says what was removed and what went with it", () => {
    expect(removalMessage(1, 0)).toBe("Removed it from this source.");
    expect(removalMessage(3, 0)).toBe("Removed 3 parts of this source.");
    expect(removalMessage(1, 1)).toBe(
      "Removed it from this source. 1 highlight in that text went with it.",
    );
    expect(removalMessage(2, 4)).toBe(
      "Removed 2 parts of this source. 4 highlights in that text went with it.",
    );
  });
});
