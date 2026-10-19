import { describe, expect, it } from "vitest";
import { SECTION_TITLE_MAX, type Card, type OutlineSection } from "@sourcefold/core";
import {
  computeCardDrop,
  computeSectionDrop,
  filterPile,
  focusAfterRemoval,
  focusOrder,
  moveCardByKey,
  moveSectionByKey,
  normalizeSectionTitle,
  pileFilterActive,
  pileSourceOptions,
  stepFocus,
  NO_PILE_FILTER,
  PILE_NO_SOURCE,
} from "../outline-model";

function makeCard(partial: Partial<Card> & { id: string }): Card {
  return {
    project_id: "p1",
    kind: "quote",
    item_id: null,
    highlight_id: null,
    quote: `quote for ${partial.id}`,
    seconds: null,
    end_seconds: null,
    url: null,
    note: null,
    script_line: null,
    section_id: null,
    position: 1000,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...partial,
  };
}

function makeSection(id: string, title: string, position: number): OutlineSection {
  return {
    id,
    project_id: "p1",
    title,
    position,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };
}

describe("normalizeSectionTitle", () => {
  it("rejects empty titles and whitespace-only titles", () => {
    expect(normalizeSectionTitle("").ok).toBe(false);
    expect(normalizeSectionTitle("   \t  \n ").ok).toBe(false);
  });

  it("trims and collapses interior whitespace", () => {
    const res = normalizeSectionTitle("  Introduction   to   Engines  ");
    expect(res).toEqual({ ok: true, title: "Introduction to Engines" });
  });

  it(`rejects titles longer than ${SECTION_TITLE_MAX} characters`, () => {
    const tooLong = "a".repeat(SECTION_TITLE_MAX + 1);
    expect(normalizeSectionTitle(tooLong).ok).toBe(false);

    const exact = "a".repeat(SECTION_TITLE_MAX);
    expect(normalizeSectionTitle(exact)).toEqual({ ok: true, title: exact });
  });
});

describe("pileFilterActive and filterPile", () => {
  const cards: Card[] = [
    makeCard({ id: "c1", item_id: "item-1", quote: "Rocket engine test" }),
    makeCard({ id: "c2", item_id: "item-2", quote: "Battery chemistry details" }),
    makeCard({ id: "c3", item_id: null, url: null, script_line: "Voiceover script line" }),
    makeCard({
      id: "c4",
      item_id: null,
      url: "https://example.com/video",
      note: "Look at rocket booster",
    }),
  ];

  it("identifies active filter state", () => {
    expect(pileFilterActive(NO_PILE_FILTER)).toBe(false);
    expect(pileFilterActive({ source: "all", text: "engine" })).toBe(true);
    expect(pileFilterActive({ source: "item-1", text: "" })).toBe(true);
  });

  it("filters cards by source item", () => {
    const result = filterPile(cards, { source: "item-1", text: "" }, () => "Source 1");
    expect(result.map((c) => c.id)).toEqual(["c1"]);
  });

  it("filters cards by no source (lines only)", () => {
    const result = filterPile(cards, { source: PILE_NO_SOURCE, text: "" }, () => null);
    expect(result.map((c) => c.id)).toEqual(["c3"]);
  });

  it("filters cards by text query across quote, script_line, and note", () => {
    const rocket = filterPile(cards, { source: "all", text: "rocket" }, () => null);
    expect(rocket.map((c) => c.id)).toEqual(["c1", "c4"]);

    const multiWord = filterPile(cards, { source: "all", text: "voiceover line" }, () => null);
    expect(multiWord.map((c) => c.id)).toEqual(["c3"]);
  });
});

describe("pileSourceOptions", () => {
  it("counts and labels sources with cards waiting in the pile", () => {
    const pile: Card[] = [
      makeCard({ id: "c1", item_id: "item-1" }),
      makeCard({ id: "c2", item_id: "item-1" }),
      makeCard({ id: "c3", item_id: null, url: null }),
      makeCard({ id: "c4", item_id: "item-2" }),
    ];

    const sourceTitles: Record<string, string> = {
      "item-1": "Alpha Source",
      "item-2": "Beta Source",
    };

    const options = pileSourceOptions(pile, (c) => (c.item_id ? sourceTitles[c.item_id] : null));

    expect(options).toEqual([
      { id: "item-1", title: "Alpha Source", count: 2 },
      { id: "item-2", title: "Beta Source", count: 1 },
      { id: PILE_NO_SOURCE, title: "Lines (no source)", count: 1 },
    ]);
  });
});

describe("computeCardDrop", () => {
  const cards: Card[] = [
    makeCard({ id: "c1", section_id: "s1", position: 100 }),
    makeCard({ id: "c2", section_id: "s1", position: 200 }),
    makeCard({ id: "c3", section_id: "s2", position: 100 }),
  ];

  it("computes position when dropping onto a container", () => {
    const patch = computeCardDrop(cards, "c3", { type: "container", sectionId: "s1" });
    expect(patch).not.toBeNull();
    expect(patch?.section_id).toBe("s1");
    expect(patch?.position).toBeGreaterThan(200);
  });

  it("computes position when dropping before or after another card", () => {
    const patchBefore = computeCardDrop(cards, "c3", { type: "card", id: "c2", after: false });
    expect(patchBefore?.section_id).toBe("s1");
    expect(patchBefore?.position).toBeGreaterThan(100);
    expect(patchBefore?.position).toBeLessThan(200);

    const patchAfter = computeCardDrop(cards, "c3", { type: "card", id: "c1", after: true });
    expect(patchAfter?.section_id).toBe("s1");
    expect(patchAfter?.position).toBeGreaterThan(100);
    expect(patchAfter?.position).toBeLessThan(200);
  });

  it("returns null if card is dropped where it already is", () => {
    const patch = computeCardDrop(cards, "c1", { type: "card", id: "c2", after: false });
    expect(patch).toBeNull();
  });
});

describe("computeSectionDrop", () => {
  const sections: OutlineSection[] = [
    makeSection("s1", "First", 100),
    makeSection("s2", "Second", 200),
    makeSection("s3", "Third", 300),
  ];

  it("calculates new position when reordering sections", () => {
    const pos = computeSectionDrop(sections, "s3", "s1", false);
    expect(pos).not.toBeNull();
    expect(pos!).toBeLessThan(100);
  });

  it("returns null if dropped in same position", () => {
    const pos = computeSectionDrop(sections, "s1", "s2", false);
    expect(pos).toBeNull();
  });
});

describe("moveCardByKey", () => {
  const sections: OutlineSection[] = [
    makeSection("s1", "First", 100),
    makeSection("s2", "Second", 200),
  ];
  const cards: Card[] = [
    makeCard({ id: "c1", section_id: "s1", position: 100 }),
    makeCard({ id: "c2", section_id: "s1", position: 200 }),
    makeCard({ id: "c3", section_id: "s2", position: 100 }),
  ];

  it("moves a card up or down within its section", () => {
    const down = moveCardByKey(cards, sections, "c1", "down");
    expect(down?.section_id).toBe("s1");
    expect(down?.position).toBeGreaterThan(200);

    const up = moveCardByKey(cards, sections, "c2", "up");
    expect(up?.section_id).toBe("s1");
    expect(up?.position).toBeLessThan(100);
  });

  it("crosses section boundaries when moving past ends", () => {
    const down = moveCardByKey(cards, sections, "c2", "down");
    expect(down?.section_id).toBe("s2");
    expect(down?.position).toBeLessThan(100);

    const up = moveCardByKey(cards, sections, "c3", "up");
    expect(up?.section_id).toBe("s1");
    expect(up?.position).toBeGreaterThan(200);
  });
});

describe("moveSectionByKey", () => {
  const sections: OutlineSection[] = [
    makeSection("s1", "First", 100),
    makeSection("s2", "Second", 200),
    makeSection("s3", "Third", 300),
  ];

  it("moves middle section up and down", () => {
    const up = moveSectionByKey(sections, "s2", "up");
    expect(up).not.toBeNull();
    expect(up!).toBeLessThan(100);

    const down = moveSectionByKey(sections, "s2", "down");
    expect(down).not.toBeNull();
    expect(down!).toBeGreaterThan(300);
  });

  it("returns null at boundaries", () => {
    expect(moveSectionByKey(sections, "s1", "up")).toBeNull();
    expect(moveSectionByKey(sections, "s3", "down")).toBeNull();
  });
});

describe("focus navigation helpers", () => {
  const pile = [makeCard({ id: "p1" }), makeCard({ id: "p2" })];
  const sections = [makeSection("s1", "Intro", 100)];
  const cards = [makeCard({ id: "c1", section_id: "s1" })];

  it("builds the linear focus order: pile, then sections with cards", () => {
    const order = focusOrder(pile, sections, cards);
    expect(order).toEqual([
      { kind: "card", id: "p1" },
      { kind: "card", id: "p2" },
      { kind: "section", id: "s1" },
      { kind: "card", id: "c1" },
    ]);
  });

  it("steps focus within bounds", () => {
    const order = focusOrder(pile, sections, cards);
    expect(stepFocus(order, "p1", 1)).toEqual({ kind: "card", id: "p2" });
    expect(stepFocus(order, "c1", 1)).toEqual({ kind: "card", id: "c1" });
    expect(stepFocus(order, "p1", -1)).toEqual({ kind: "card", id: "p1" });
  });

  it("finds next focus target after removal", () => {
    const order = focusOrder(pile, sections, cards);
    expect(focusAfterRemoval(order, "p2")).toEqual({ kind: "section", id: "s1" });
    expect(focusAfterRemoval(order, "c1")).toEqual({ kind: "section", id: "s1" });
  });
});
