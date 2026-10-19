import { describe, expect, it } from "vitest";
import type { Card } from "@sourcefold/core";
import type { Item } from "@/lib/types";
import {
  applyCardPatch,
  buildSourceDirectory,
  cardsIn,
  projectViewCounts,
  releaseSectionCards,
  renameTagOnItems,
  revertPatch,
  sourcesWithTag,
  sourceTitleFor,
  taggedCounts,
} from "../project-data-model";

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

function makeItem(id: string, title: string, partial: Partial<Item> = {}): Item {
  return {
    id,
    folder_id: "g1",
    title,
    kind: "web",
    status: "saved",
    meta: {},
    source_url: `https://example.com/${id}`,
    canonical_url: null,
    author: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...partial,
  };
}

describe("cardsIn", () => {
  const cards: Card[] = [
    makeCard({ id: "c1", section_id: "s1", position: 200 }),
    makeCard({ id: "c2", section_id: "s1", position: 100 }),
    makeCard({ id: "c3", section_id: null, created_at: "2026-10-01T01:00:00Z" }),
    makeCard({ id: "c4", section_id: null, created_at: "2026-10-01T02:00:00Z" }),
  ];

  it("filters and sorts placed cards by position ascending", () => {
    const placed = cardsIn(cards, "s1");
    expect(placed.map((c) => c.id)).toEqual(["c2", "c1"]);
  });

  it("filters and sorts unplaced pile cards", () => {
    const pile = cardsIn(cards, null);
    expect(pile.map((c) => c.id).sort()).toEqual(["c3", "c4"]);
  });
});

describe("projectViewCounts", () => {
  it("computes counts for outline, broll, and duplicates", () => {
    const cards: Card[] = [
      makeCard({ id: "c1", section_id: "s1" }),
      makeCard({ id: "c2", section_id: null }),
      makeCard({ id: "c3", kind: "broll" }),
      makeCard({ id: "c4", kind: "quote" }),
    ];

    const items: Item[] = [
      makeItem("i1", "Article 1", { source_url: "https://example.com/same" }),
      makeItem("i2", "Article 2", { source_url: "https://example.com/same" }),
      makeItem("i3", "Article 3", { source_url: "https://example.com/different" }),
    ];

    const counts = projectViewCounts(cards, items);
    expect(counts).toEqual({
      outline: 4, // total cards
      broll: 1, // c3
      duplicates: 1, // 1 duplicate set
    });
  });
});

describe("applyCardPatch and revertPatch", () => {
  const cards: Card[] = [
    makeCard({ id: "c1", quote: "Old quote", position: 100 }),
    makeCard({ id: "c2", quote: "Other quote", position: 200 }),
  ];

  it("applies updates to card fields in the cards array", () => {
    const patched = applyCardPatch(cards, "c1", { quote: "New quote", position: 250 });
    expect(patched[0].quote).toBe("New quote");
    expect(patched[0].position).toBe(250);
    expect(patched[1].quote).toBe("Other quote");
  });

  it("reverts only the fields present in the patch", () => {
    const card = cards[0];
    const patch = { quote: "New quote", position: 250 };
    const back = revertPatch(card, patch);
    expect(back).toEqual({ quote: "Old quote", position: 100 });
  });
});

describe("releaseSectionCards", () => {
  it("clears section_id on cards that were in the deleted section", () => {
    const cards: Card[] = [
      makeCard({ id: "c1", section_id: "s1" }),
      makeCard({ id: "c2", section_id: "s2" }),
    ];
    const released = releaseSectionCards(cards, "s1");
    expect(released.find((c) => c.id === "c1")?.section_id).toBeNull();
    expect(released.find((c) => c.id === "c2")?.section_id).toBe("s2");
  });
});

describe("sourceTitleFor", () => {
  const items = [
    makeItem("i1", "Wikipedia Article", { source_url: "https://en.wikipedia.org/wiki/Test" }),
  ];
  const itemsById = new Map(items.map((i) => [i.id, i]));

  it("resolves title from item_id", () => {
    const card = makeCard({ id: "c1", item_id: "i1" });
    expect(sourceTitleFor(card, itemsById)).toBe("Wikipedia Article");
  });

  it("falls back to hostname if item is missing and url exists", () => {
    const card = makeCard({ id: "c2", item_id: null, url: "https://www.youtube.com/watch?v=123" });
    expect(sourceTitleFor(card, itemsById)).toBe("youtube.com");
  });

  it("returns null if no item and no url", () => {
    const card = makeCard({ id: "c3", item_id: null, url: null });
    expect(sourceTitleFor(card, itemsById)).toBeNull();
  });
});

describe("tag operations: renameTagOnItems, sourcesWithTag, taggedCounts", () => {
  const items: Item[] = [
    makeItem("i1", "Item 1", { tags: ["Engines", "Space"] }),
    makeItem("i2", "Item 2", { tags: ["Space"] }),
    makeItem("i3", "Item 3", { tags: ["propulsion"] }),
  ];

  it("renames tags across items case-insensitively", () => {
    const renamed = renameTagOnItems(items, "engines", "Rocket Engines");
    expect(renamed[0].tags).toEqual(["Rocket Engines", "Space"]);
    expect(renamed[1].tags).toEqual(["Space"]);
  });

  it("finds sources with tag case-insensitively", () => {
    expect(sourcesWithTag(items, "space").map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(sourcesWithTag(items, "PROPULSION").map((i) => i.id)).toEqual(["i3"]);
  });

  it("counts tagged sources per section", () => {
    const sections = [
      { id: "s1", project_id: "p1", title: "Space", position: 100, created_at: "", updated_at: "" },
      {
        id: "s2",
        project_id: "p1",
        title: "Propulsion",
        position: 200,
        created_at: "",
        updated_at: "",
      },
    ];
    const counts = taggedCounts(sections, items);
    expect(counts).toEqual({ s1: 2, s2: 1 });
  });
});

describe("buildSourceDirectory", () => {
  it("builds a directory of ScriptSources indexed by item id", () => {
    const items = [
      makeItem("i1", "Starship Flight 5", {
        author: "SpaceX",
        source_url: "https://spacex.com",
      }),
    ];
    const dir = buildSourceDirectory(items);
    expect(dir["i1"]).toEqual({
      item_id: "i1",
      title: "Starship Flight 5",
      byline: ["SpaceX", "spacex.com"],
      url: "https://spacex.com",
    });
  });
});
